import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { HttpError } from "../lib/http-error";
import { PROJECT_RUNTIME_DIR } from "../paths";
import { resolveManagedOpenClawLaunchSpec } from "./project-managed-openclaw";
import { validateConfigObject, type ConfigValidationIssue } from "./project-config-validator";
import { probeTcpPort } from "./project-probe";
import type {
  CommandExecutionResult,
  ProjectActionName,
  ProjectCustomCommandLifecycle,
  StoredProjectRecord,
} from "../types/project";

const COMMAND_TIMEOUT_MS = 60_000;
const MANAGED_STOP_TIMEOUT_MS = 15_000;
const MANAGED_POLL_INTERVAL_MS = 250;
const LOG_TAIL_BYTES = 8192;

type ManagedRuntimeState = {
  pid: number;
  command: string;
  logPath: string;
  startedAt: string;
};

export type ExecuteProjectActionOptions = {
  runtimeDir?: string;
};

function getCustomLifecycle(project: StoredProjectRecord): ProjectCustomCommandLifecycle {
  if (project.lifecycle.mode !== "custom_commands") {
    throw new HttpError(400, `Project "${project.id}" does not use custom lifecycle commands.`);
  }

  return project.lifecycle;
}

function getActionCommand(project: StoredProjectRecord, action: ProjectActionName): string {
  const lifecycle = getCustomLifecycle(project);

  if (action === "start") {
    return lifecycle.startCommand;
  }

  if (action === "stop") {
    return lifecycle.stopCommand;
  }

  return lifecycle.restartCommand;
}

function buildResult(input: {
  ok: boolean;
  command: string;
  startedAt: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}): CommandExecutionResult {
  return {
    ok: input.ok,
    command: input.command,
    exitCode: input.exitCode ?? null,
    signal: input.signal ?? null,
    stdout: input.stdout?.trim() ?? "",
    stderr: input.stderr?.trim() ?? "",
    durationMs: Date.now() - input.startedAt,
  };
}

async function runCommand(command: string, cwd: string): Promise<CommandExecutionResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("/bin/sh", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (
      ok: boolean,
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      stderrSuffix = "",
    ) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(
        buildResult({
          ok,
          command,
          startedAt,
          exitCode,
          signal,
          stdout,
          stderr: `${stderr}${stderrSuffix}`,
        }),
      );
    };

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(false, null, "SIGTERM", "\nCommand timed out after 60000ms.");
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish(false, null, null, `\n${error.message}`);
    });
    child.on("close", (exitCode, signal) => {
      finish(exitCode === 0, exitCode, signal);
    });
  });
}

function getProjectRuntimePaths(project: StoredProjectRecord, runtimeDir: string) {
  const projectRuntimeDir = path.join(runtimeDir, project.id);
  return {
    projectRuntimeDir,
    statePath: path.join(projectRuntimeDir, "state.json"),
    logPath: path.join(projectRuntimeDir, "gateway.log"),
  };
}

async function ensureDirectory(targetPath: string): Promise<void> {
  await fsp.mkdir(targetPath, { recursive: true });
}

async function readManagedState(statePath: string): Promise<ManagedRuntimeState | null> {
  try {
    const raw = await fsp.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "pid" in parsed &&
      typeof parsed.pid === "number" &&
      "command" in parsed &&
      typeof parsed.command === "string" &&
      "logPath" in parsed &&
      typeof parsed.logPath === "string" &&
      "startedAt" in parsed &&
      typeof parsed.startedAt === "string"
    ) {
      return parsed as ManagedRuntimeState;
    }
  } catch {
    return null;
  }

  return null;
}

async function writeManagedState(statePath: string, state: ManagedRuntimeState): Promise<void> {
  await ensureDirectory(path.dirname(statePath));
  await fsp.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function removeManagedState(statePath: string): Promise<void> {
  await fsp.rm(statePath, { force: true });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return true;
    }

    return false;
  }
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function waitForPortState(options: {
  host: string;
  port: number;
  expectOpen: boolean;
  timeoutMs: number;
}): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() <= deadline) {
    const portOpen = await probeTcpPort(options.host, options.port, 600);
    if (portOpen === options.expectOpen) {
      return true;
    }

    await sleep(MANAGED_POLL_INTERVAL_MS);
  }

  return false;
}

async function tailLog(logPath: string): Promise<string> {
  try {
    const handle = await fsp.open(logPath, "r");
    try {
      const stats = await handle.stat();
      const start = Math.max(0, stats.size - LOG_TAIL_BYTES);
      const length = stats.size - start;
      const buffer = Buffer.alloc(Math.max(length, 0));
      await handle.read(buffer, 0, buffer.length, start);
      return buffer.toString("utf8").trim();
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

async function preflightConfigCheck(project: StoredProjectRecord): Promise<ConfigValidationIssue[]> {
  try {
    const raw = await fsp.readFile(project.paths.configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return [{ path: "<root>", message: "Config file is not a JSON object.", severity: "error" }];
    }
    return validateConfigObject(parsed as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function executeManagedStart(
  project: StoredProjectRecord,
  runtimeDir: string,
): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  const runtimePaths = getProjectRuntimePaths(project, runtimeDir);
  await ensureDirectory(runtimePaths.projectRuntimeDir);

  // Pre-flight: reject start if config has known-bad values that would crash the gateway.
  const configIssues = await preflightConfigCheck(project);
  const configErrors = configIssues.filter((issue) => issue.severity === "error");
  if (configErrors.length > 0) {
    const detail = configErrors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
    return buildResult({
      ok: false,
      command: `managed start ${project.id}`,
      startedAt,
      exitCode: 1,
      stderr: `Config pre-flight check failed. The gateway would crash on startup.\n${detail}\nFix these issues in the config before starting.`,
    });
  }

  const existingState = await readManagedState(runtimePaths.statePath);
  const portOpen = await probeTcpPort(project.gateway.host, project.gateway.port, 800);

  if (existingState && isPidAlive(existingState.pid) && portOpen) {
    return buildResult({
      ok: true,
      command: existingState.command,
      startedAt,
      exitCode: 0,
      stdout: `Project already running under manager launcher (pid ${existingState.pid}).`,
    });
  }

  if (portOpen) {
    return buildResult({
      ok: false,
      command: existingState?.command ?? `managed start ${project.id}`,
      startedAt,
      exitCode: 1,
      stderr:
        "Gateway port is already in use, but manager does not have a live runtime state for this project.",
    });
  }

  if (existingState && !isPidAlive(existingState.pid)) {
    await removeManagedState(runtimePaths.statePath);
  }

  const spec = await resolveManagedOpenClawLaunchSpec(project);
  const logFd = fs.openSync(runtimePaths.logPath, "a");
  let childPid: number | undefined;

  try {
    const child = spawn("/bin/sh", ["-lc", `exec ${spec.displayCommand}`], {
      cwd: spec.cwd,
      env: spec.env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });

    childPid = child.pid;
    if (typeof childPid !== "number") {
      throw new HttpError(500, `Manager could not start project "${project.id}".`);
    }

    child.unref();
  } finally {
    fs.closeSync(logFd);
  }

  const started = await waitForPortState({
    host: project.gateway.host,
    port: project.gateway.port,
    expectOpen: true,
    timeoutMs: spec.startupTimeoutMs,
  });

  if (!started) {
    if (isPidAlive(childPid)) {
      try {
        process.kill(childPid, "SIGTERM");
      } catch {
        // Ignore cleanup failures.
      }
    }

    await removeManagedState(runtimePaths.statePath);
    const stderr = await tailLog(runtimePaths.logPath);
    return buildResult({
      ok: false,
      command: spec.displayCommand,
      startedAt,
      exitCode: 1,
      stderr:
        stderr.length > 0
          ? stderr
          : `Managed OpenClaw did not open port ${project.gateway.port} within ${spec.startupTimeoutMs}ms.`,
    });
  }

  await writeManagedState(runtimePaths.statePath, {
    pid: childPid,
    command: spec.displayCommand,
    logPath: runtimePaths.logPath,
    startedAt: new Date().toISOString(),
  });

  return buildResult({
    ok: true,
    command: spec.displayCommand,
    startedAt,
    exitCode: 0,
    stdout: `Managed OpenClaw started on ${project.gateway.host}:${project.gateway.port} (pid ${childPid}).`,
  });
}

async function executeManagedStop(
  project: StoredProjectRecord,
  runtimeDir: string,
): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  const runtimePaths = getProjectRuntimePaths(project, runtimeDir);
  const existingState = await readManagedState(runtimePaths.statePath);
  const command = existingState?.command ?? `managed stop ${project.id}`;

  if (!existingState) {
    const portOpen = await probeTcpPort(project.gateway.host, project.gateway.port, 800);
    if (!portOpen) {
      return buildResult({
        ok: true,
        command,
        startedAt,
        exitCode: 0,
        stdout: "Project is already stopped.",
      });
    }

    return buildResult({
      ok: false,
      command,
      startedAt,
      exitCode: 1,
      stderr:
        "Gateway port is still open, but manager has no runtime state for this project. Stop it manually or re-register it with custom commands.",
    });
  }

  if (isPidAlive(existingState.pid)) {
    try {
      process.kill(existingState.pid, "SIGTERM");
    } catch (error) {
      return buildResult({
        ok: false,
        command,
        startedAt,
        exitCode: 1,
        stderr: error instanceof Error ? error.message : "Failed to send SIGTERM.",
      });
    }
  }

  const stopped = await waitForPortState({
    host: project.gateway.host,
    port: project.gateway.port,
    expectOpen: false,
    timeoutMs: MANAGED_STOP_TIMEOUT_MS,
  });

  if (stopped && isPidAlive(existingState.pid)) {
    const exitDeadline = Date.now() + 2000;
    while (Date.now() <= exitDeadline && isPidAlive(existingState.pid)) {
      await sleep(100);
    }
  }

  if ((!stopped || isPidAlive(existingState.pid)) && isPidAlive(existingState.pid)) {
    try {
      process.kill(existingState.pid, "SIGKILL");
    } catch {
      // Ignore escalation failures and report below.
    }
    await sleep(500);
  }

  const portStillOpen = await probeTcpPort(project.gateway.host, project.gateway.port, 800);
  const pidAlive = isPidAlive(existingState.pid);

  if (!portStillOpen && !pidAlive) {
    await removeManagedState(runtimePaths.statePath);
    return buildResult({
      ok: true,
      command,
      startedAt,
      exitCode: 0,
      stdout: `Managed OpenClaw stopped (pid ${existingState.pid}).`,
    });
  }

  const stderr = await tailLog(existingState.logPath);
  return buildResult({
    ok: false,
    command,
    startedAt,
    exitCode: 1,
    stderr:
      stderr.length > 0
        ? stderr
        : `Managed OpenClaw did not stop cleanly for project "${project.id}".`,
  });
}

async function executeManagedRestart(
  project: StoredProjectRecord,
  runtimeDir: string,
): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  const stopResult = await executeManagedStop(project, runtimeDir);
  if (!stopResult.ok) {
    return buildResult({
      ok: false,
      command: `managed restart ${project.id}`,
      startedAt,
      exitCode: stopResult.exitCode,
      signal: stopResult.signal,
      stdout: stopResult.stdout,
      stderr: stopResult.stderr,
    });
  }

  const startResult = await executeManagedStart(project, runtimeDir);
  return buildResult({
    ok: startResult.ok,
    command: `managed restart ${project.id}`,
    startedAt,
    exitCode: startResult.exitCode,
    signal: startResult.signal,
    stdout: [stopResult.stdout, startResult.stdout].filter(Boolean).join("\n"),
    stderr: [stopResult.stderr, startResult.stderr].filter(Boolean).join("\n"),
  });
}

async function executeManagedProjectAction(
  project: StoredProjectRecord,
  action: ProjectActionName,
  runtimeDir: string,
): Promise<CommandExecutionResult> {
  if (action === "start") {
    return executeManagedStart(project, runtimeDir);
  }

  if (action === "stop") {
    return executeManagedStop(project, runtimeDir);
  }

  return executeManagedRestart(project, runtimeDir);
}

export async function executeProjectAction(
  project: StoredProjectRecord,
  action: ProjectActionName,
  options?: ExecuteProjectActionOptions,
): Promise<CommandExecutionResult> {
  if (project.lifecycle.mode === "managed_openclaw") {
    return executeManagedProjectAction(project, action, options?.runtimeDir ?? PROJECT_RUNTIME_DIR);
  }

  const command = getActionCommand(project, action).trim();

  if (command.length === 0) {
    throw new HttpError(400, `Project "${project.id}" does not define a ${action} command.`);
  }

  return runCommand(command, project.paths.rootPath);
}

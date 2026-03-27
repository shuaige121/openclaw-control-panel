import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../lib/http-error";
import type { ProjectManagedOpenClawLifecycle, StoredProjectRecord } from "../types/project";

export type ManagedOpenClawLaunchSpec = {
  command: string;
  args: string[];
  displayCommand: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  startupTimeoutMs: number;
};

function quoteShell(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getManagedLifecycle(project: StoredProjectRecord): ProjectManagedOpenClawLifecycle {
  if (project.lifecycle.mode !== "managed_openclaw") {
    throw new HttpError(
      400,
      `Project "${project.id}" is not configured for Control Panel-managed OpenClaw runtime.`,
    );
  }

  return project.lifecycle;
}

function resolveNodePath(lifecycle: ProjectManagedOpenClawLifecycle): string {
  return lifecycle.nodePath?.trim() || process.execPath;
}

async function resolveCliInvocation(project: StoredProjectRecord): Promise<{
  command: string;
  argsPrefix: string[];
  displayPrefix: string;
  message: string;
}> {
  const lifecycle = getManagedLifecycle(project);
  const cliPath = lifecycle.cliPath?.trim() ?? "";
  const nodePath = resolveNodePath(lifecycle);

  if (cliPath.length > 0) {
    const looksLikeFilePath =
      path.isAbsolute(cliPath) ||
      cliPath.includes("/") ||
      cliPath.endsWith(".mjs") ||
      cliPath.endsWith(".js");

    if (!looksLikeFilePath) {
      return {
        command: cliPath,
        argsPrefix: [],
        displayPrefix: quoteShell(cliPath),
        message: `Using CLI command "${cliPath}" from PATH.`,
      };
    }

    const resolvedCliPath = path.isAbsolute(cliPath)
      ? cliPath
      : path.resolve(project.paths.rootPath, cliPath);
    if (!(await pathExists(resolvedCliPath))) {
      throw new HttpError(
        400,
        `Managed OpenClaw CLI path "${resolvedCliPath}" does not exist for project "${project.id}".`,
      );
    }

    return {
      command: nodePath,
      argsPrefix: [resolvedCliPath],
      displayPrefix: `${quoteShell(nodePath)} ${quoteShell(resolvedCliPath)}`,
      message: `Using CLI module at ${resolvedCliPath}.`,
    };
  }

  const bundledCliPath = path.join(project.paths.rootPath, "openclaw.mjs");
  if (await pathExists(bundledCliPath)) {
    return {
      command: nodePath,
      argsPrefix: [bundledCliPath],
      displayPrefix: `${quoteShell(nodePath)} ${quoteShell(bundledCliPath)}`,
      message: `Detected openclaw.mjs under ${project.paths.rootPath}.`,
    };
  }

  return {
    command: "openclaw",
    argsPrefix: [],
    displayPrefix: "openclaw",
    message: 'No local openclaw.mjs found; Control Panel will use "openclaw" from PATH.',
  };
}

export async function inspectManagedOpenClawRuntime(project: StoredProjectRecord): Promise<{
  supported: boolean;
  message: string;
}> {
  if (project.lifecycle.mode !== "managed_openclaw") {
    return {
      supported: false,
      message: "Project lifecycle is not set to Control Panel-managed OpenClaw.",
    };
  }

  const rootExists = await pathExists(project.paths.rootPath);
  if (!rootExists) {
    return {
      supported: false,
      message: `Project root ${project.paths.rootPath} does not exist.`,
    };
  }

  const configExists = await pathExists(project.paths.configPath);
  if (!configExists) {
    return {
      supported: false,
      message: `Config file ${project.paths.configPath} does not exist.`,
    };
  }

  const invocation = await resolveCliInvocation(project);
  return {
    supported: true,
    message: invocation.message,
  };
}

export async function resolveManagedOpenClawLaunchSpec(
  project: StoredProjectRecord,
): Promise<ManagedOpenClawLaunchSpec> {
  const lifecycle = getManagedLifecycle(project);
  const invocation = await resolveCliInvocation(project);
  const bind = lifecycle.bind;
  const args = [
    ...invocation.argsPrefix,
    "gateway",
    "run",
    "--bind",
    bind,
    "--port",
    String(project.gateway.port),
  ];

  if (lifecycle.allowUnconfigured) {
    args.push("--allow-unconfigured");
  }

  return {
    command: invocation.command,
    args,
    displayCommand: `${invocation.displayPrefix} ${args
      .slice(invocation.argsPrefix.length)
      .map((value) => quoteShell(value))
      .join(" ")}`.trim(),
    cwd: project.paths.rootPath,
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: project.paths.configPath,
      OPENCLAW_STATE_DIR: path.dirname(project.paths.configPath),
    },
    startupTimeoutMs: lifecycle.startupTimeoutMs,
  };
}

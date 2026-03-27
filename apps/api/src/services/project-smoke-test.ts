import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { HttpError } from "../lib/http-error";
import type {
  CommandExecutionResult,
  ProjectAuthStrategy,
  ProjectSmokeTestResponse,
  ProjectSmokeTestScenarioId,
  ProjectSmokeTestScenarioResult,
  StoredProjectRecord,
} from "../types/project";

const SMOKE_TEST_TIMEOUT_MS = 120_000;

type ScenarioDefinition = {
  id: ProjectSmokeTestScenarioId;
  label: string;
  prompt: string;
  validate: (outputText: string, toolHint: string | null) => string | null;
};

type CliInvocation = {
  command: string;
  argsPrefix: string[];
  displayPrefix: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
};

type RawAgentResponse = {
  result?: {
    payloads?: Array<{
      text?: string;
    }>;
    meta?: {
      durationMs?: number;
      agentMeta?: {
        provider?: string;
        model?: string;
      };
    };
  };
};

type SmokeScenarioExecution = {
  result: ProjectSmokeTestScenarioResult;
  command: string;
  stdout: string;
  stderr: string;
};

export type ProjectSmokeTestExecution = {
  response: ProjectSmokeTestResponse;
  commandLog: string;
  stdoutLog: string;
  stderrLog: string;
};

const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "model_identity",
    label: "模型识别",
    prompt: "Reply in one short sentence: what model are you currently using?",
    validate(outputText) {
      return outputText.trim().length > 0 ? null : "Agent returned an empty model answer.";
    },
  },
  {
    id: "tool_exec_time",
    label: "本机时间工具",
    prompt:
      "Use a tool to get the current UTC time from this server. Reply with exactly two lines: first line is the UTC timestamp, second line is the tool you used.",
    validate(outputText, toolHint) {
      if (!/utc/i.test(outputText)) {
        return "UTC timestamp was missing from the response.";
      }

      if (!toolHint || !/exec|process|date/i.test(toolHint)) {
        return "The response did not clearly report an exec-style tool.";
      }

      return null;
    },
  },
  {
    id: "tool_web_fetch",
    label: "网页抓取工具",
    prompt:
      "Use web_search or web_fetch to find the title of the OpenClaw docs homepage at https://docs.openclaw.ai . Reply with exactly two lines: first line the page title, second line the tool you used.",
    validate(outputText, toolHint) {
      if (outputText.trim().length === 0) {
        return "The docs title response was empty.";
      }

      if (!toolHint || !/web_fetch|web_search/i.test(toolHint)) {
        return "The response did not clearly report a web tool.";
      }

      return null;
    },
  },
  {
    id: "context_recall",
    label: "上下文承接",
    prompt: "In one short sentence, what was the previous question I asked you in this session?",
    validate(outputText) {
      const normalized = outputText.toLowerCase();
      if (
        normalized.includes("docs.openclaw.ai") ||
        normalized.includes("docs homepage") ||
        normalized.includes("openclaw docs") ||
        normalized.includes("web_search") ||
        normalized.includes("web_fetch") ||
        normalized.includes("title")
      ) {
        return null;
      }

      return "The agent did not recall the previous web-fetch prompt.";
    },
  },
];

function quoteShell(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
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

function getProjectStateDir(project: StoredProjectRecord): string {
  return path.dirname(project.paths.configPath);
}

async function resolveCliInvocation(
  project: StoredProjectRecord,
  auth: { strategy: ProjectAuthStrategy; secret: string },
): Promise<CliInvocation> {
  const rootPath = project.paths.rootPath;
  const stateDir = getProjectStateDir(project);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCLAW_CONFIG_PATH: project.paths.configPath,
    OPENCLAW_STATE_DIR: stateDir,
  };

  if (auth.strategy === "token") {
    env.OPENCLAW_GATEWAY_TOKEN = auth.secret;
  } else {
    env.OPENCLAW_GATEWAY_PASSWORD = auth.secret;
  }

  if (project.lifecycle.mode === "managed_openclaw") {
    const cliPath = project.lifecycle.cliPath?.trim() ?? "";
    const nodePath = project.lifecycle.nodePath?.trim() || process.execPath;

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
          cwd: rootPath,
          env,
        };
      }

      const resolvedCliPath = path.isAbsolute(cliPath) ? cliPath : path.resolve(rootPath, cliPath);
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
        cwd: rootPath,
        env,
      };
    }
  }

  const bundledCliPath = path.join(rootPath, "openclaw.mjs");
  if (await pathExists(bundledCliPath)) {
    return {
      command: process.execPath,
      argsPrefix: [bundledCliPath],
      displayPrefix: `${quoteShell(process.execPath)} ${quoteShell(bundledCliPath)}`,
      cwd: rootPath,
      env,
    };
  }

  const packageJsonPath = path.join(rootPath, "package.json");
  if (await pathExists(packageJsonPath)) {
    return {
      command: "npm",
      argsPrefix: ["exec", "openclaw", "--"],
      displayPrefix: "npm exec openclaw --",
      cwd: rootPath,
      env,
    };
  }

  return {
    command: "openclaw",
    argsPrefix: [],
    displayPrefix: "openclaw",
    cwd: rootPath,
    env,
  };
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

async function runCliCommand(invocation: CliInvocation, args: string[]): Promise<CommandExecutionResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const command = `${invocation.displayPrefix} ${args.map((value) => quoteShell(value)).join(" ")}`.trim();
    const child = spawn(invocation.command, [...invocation.argsPrefix, ...args], {
      cwd: invocation.cwd,
      env: invocation.env,
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
      finish(false, null, "SIGTERM", "\nSmoke test timed out after 120000ms.");
    }, SMOKE_TEST_TIMEOUT_MS);

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

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Agent returned an empty stdout payload.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Agent stdout did not contain a JSON object.");
    }

    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAgentResponse(stdout: string): RawAgentResponse {
  const parsed = tryParseJson(stdout);
  if (!isObject(parsed)) {
    throw new Error("Agent JSON payload must be an object.");
  }

  return parsed as RawAgentResponse;
}

function collectOutputText(response: RawAgentResponse): string {
  const payloads = response.result?.payloads;
  if (!Array.isArray(payloads)) {
    return "";
  }

  return payloads
    .map((payload) => (typeof payload?.text === "string" ? payload.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractToolHint(outputText: string): string | null {
  const lines = outputText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length >= 2) {
    return lines[1] ?? null;
  }

  const match = outputText.match(/\b(exec|process|web_fetch|web_search|browser|read|write)\b/i);
  return match?.[0]?.trim() ?? null;
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error(`${filePath} did not contain a JSON object.`);
  }
  return parsed;
}

async function maybeApprovePendingPairing(stateDir: string): Promise<boolean> {
  const identityPath = path.join(stateDir, "identity", "device.json");
  const pendingPath = path.join(stateDir, "devices", "pending.json");
  const pairedPath = path.join(stateDir, "devices", "paired.json");

  if (!(await pathExists(identityPath)) || !(await pathExists(pendingPath))) {
    return false;
  }

  const identity = await readJsonFile(identityPath);
  const deviceId = typeof identity.deviceId === "string" ? identity.deviceId.trim() : "";
  if (deviceId.length === 0) {
    return false;
  }

  const pending = await readJsonFile(pendingPath);
  const request = Object.values(pending).find(
    (value) => isObject(value) && typeof value.deviceId === "string" && value.deviceId === deviceId,
  );

  if (!request || !isObject(request) || typeof request.requestId !== "string") {
    return false;
  }

  const paired = (await pathExists(pairedPath)) ? await readJsonFile(pairedPath) : {};
  const now = Date.now();

  paired[deviceId] = {
    deviceId,
    publicKey: request.publicKey,
    displayName: request.displayName,
    platform: request.platform,
    clientId: request.clientId,
    clientMode: request.clientMode,
    role: request.role,
    roles: request.roles,
    scopes: request.scopes,
    remoteIp: request.remoteIp,
    createdAtMs: typeof request.ts === "number" ? request.ts : now,
    approvedAtMs: now,
  };

  delete pending[request.requestId];

  await fs.mkdir(path.dirname(pendingPath), { recursive: true });
  await Promise.all([
    fs.writeFile(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, "utf8"),
    fs.writeFile(pairedPath, `${JSON.stringify(paired, null, 2)}\n`, "utf8"),
  ]);

  return true;
}

async function runScenario(
  invocation: CliInvocation,
  project: StoredProjectRecord,
  stateDir: string,
  sessionId: string,
  scenario: ScenarioDefinition,
): Promise<SmokeScenarioExecution> {
  const baseArgs = [
    "agent",
    "--json",
    "--thinking",
    "minimal",
    "--timeout",
    "120",
    "--session-id",
    sessionId,
    "--message",
    scenario.prompt,
  ];

  const argsWithAgent = ["agent", "--agent", project.id, ...baseArgs.slice(1)];
  let execution = await runCliCommand(invocation, argsWithAgent);
  if (!execution.ok && /unknown agent id/i.test(`${execution.stdout}\n${execution.stderr}`)) {
    execution = await runCliCommand(invocation, baseArgs);
  }
  if (!execution.ok && /pairing required/i.test(`${execution.stdout}\n${execution.stderr}`)) {
    const repaired = await maybeApprovePendingPairing(stateDir);
    if (repaired) {
      execution = await runCliCommand(invocation, argsWithAgent);
      if (!execution.ok && /unknown agent id/i.test(`${execution.stdout}\n${execution.stderr}`)) {
        execution = await runCliCommand(invocation, baseArgs);
      }
    }
  }

  if (!execution.ok) {
    return {
      result: {
        id: scenario.id,
        label: scenario.label,
        ok: false,
        durationMs: execution.durationMs,
        outputText: execution.stdout,
        toolHint: null,
        provider: null,
        model: null,
        error: execution.stderr || execution.stdout || "Smoke test command failed.",
      },
      command: execution.command,
      stdout: execution.stdout,
      stderr: execution.stderr,
    };
  }

  let response: RawAgentResponse;
  try {
    response = parseAgentResponse(execution.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse agent JSON output.";
    return {
      result: {
        id: scenario.id,
        label: scenario.label,
        ok: false,
        durationMs: execution.durationMs,
        outputText: execution.stdout,
        toolHint: null,
        provider: null,
        model: null,
        error: message,
      },
      command: execution.command,
      stdout: execution.stdout,
      stderr: execution.stderr,
    };
  }

  const outputText = collectOutputText(response);
  const toolHint = extractToolHint(outputText);
  const provider = response.result?.meta?.agentMeta?.provider ?? null;
  const model = response.result?.meta?.agentMeta?.model ?? null;
  const validationError = scenario.validate(outputText, toolHint);

  return {
    result: {
      id: scenario.id,
      label: scenario.label,
      ok: validationError === null,
      durationMs:
        typeof response.result?.meta?.durationMs === "number"
          ? response.result.meta.durationMs
          : execution.durationMs,
      outputText,
      toolHint,
      provider,
      model,
      error: validationError,
    },
    command: execution.command,
    stdout: execution.stdout,
    stderr: execution.stderr,
  };
}

export async function runProjectSmokeTest(params: {
  project: StoredProjectRecord;
  gatewayAuth: {
    strategy: ProjectAuthStrategy;
    secret: string;
  };
}): Promise<ProjectSmokeTestExecution> {
  const startedAt = new Date().toISOString();
  const invocation = await resolveCliInvocation(params.project, params.gatewayAuth);
  const stateDir = getProjectStateDir(params.project);
  const sessionId = `manager-smoke-${crypto.randomUUID()}`;
  const executions: SmokeScenarioExecution[] = [];

  for (const scenario of SCENARIOS) {
    executions.push(await runScenario(invocation, params.project, stateDir, sessionId, scenario));
  }

  const results = executions.map((entry) => entry.result);
  const passed = results.filter((entry) => entry.ok).length;
  const provider = results.find((entry) => entry.provider)?.provider ?? null;
  const model = results.find((entry) => entry.model)?.model ?? null;

  return {
    response: {
      ok: passed === results.length,
      projectId: params.project.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      sessionId,
      summary: {
        passed,
        total: results.length,
        provider,
        model,
      },
      results,
    },
    commandLog: executions.map((entry) => entry.command).join("\n\n"),
    stdoutLog: executions
      .map((entry) => `${entry.result.label}\n${entry.result.outputText || entry.stdout || "(empty)"}`)
      .join("\n\n"),
    stderrLog: executions
      .map((entry) => {
        const parts = [entry.result.error, entry.stderr].filter(Boolean);
        if (parts.length === 0) {
          return "";
        }
        return `${entry.result.label}\n${parts.join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n"),
  };
}

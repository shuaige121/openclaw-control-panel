import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { HttpError } from "../lib/http-error";

type ChannelType = "telegram" | "wecom" | "feishu" | "whatsapp" | "none";
type SandboxMode = "off" | "all";
type LinkMode = "symlink" | "copy";

export interface CreateInstanceOptions {
  profileName: string;
  displayName: string;
  description?: string;
  model?: string;
  port?: number;
  channelType?: ChannelType;
  channelCredentials?: Record<string, string>;
  sandboxMode?: SandboxMode;
  tags?: string[];
}

export interface CreateInstanceRuntimeOptions {
  homeDir?: string;
  managerRootDir?: string;
  uvBin?: string;
  authLinkMode?: LinkMode;
}

export interface CreateInstanceResult {
  profileName: string;
  port: number;
  rootPath: string;
  configPath: string;
  workspacePath: string;
  stateDirPath: string;
  authLinkMode: string;
  modelsLinkMode: string;
  extensionsLinkMode: string;
}

type ProvisionerPayload = {
  profileName: string;
  port: number;
  rootPath: string;
  configPath: string;
  workspacePath: string;
  stateDirPath: string;
  authLinkMode: string;
  modelsLinkMode: string;
  extensionsLinkMode: string;
};

function resolveManagerRootDir(runtimeOptions?: CreateInstanceRuntimeOptions): string {
  return runtimeOptions?.managerRootDir ?? path.resolve(__dirname, "../../../..");
}

function resolveHomeDir(runtimeOptions?: CreateInstanceRuntimeOptions): string {
  return runtimeOptions?.homeDir ?? os.homedir();
}

function resolveUvBin(runtimeOptions?: CreateInstanceRuntimeOptions): string {
  return runtimeOptions?.uvBin?.trim() || "uv";
}

function parseProvisionerPayload(stdout: string): CreateInstanceResult {
  let payload: unknown;

  try {
    payload = JSON.parse(stdout) as unknown;
  } catch {
    throw new HttpError(500, "Python provisioner returned invalid JSON.");
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new HttpError(500, "Python provisioner returned an invalid payload.");
  }

  const parsed = payload as Partial<ProvisionerPayload>;
  const stringFields = [
    "profileName",
    "rootPath",
    "configPath",
    "workspacePath",
    "stateDirPath",
    "authLinkMode",
    "modelsLinkMode",
    "extensionsLinkMode",
  ] as const;

  for (const fieldName of stringFields) {
    if (typeof parsed[fieldName] !== "string" || parsed[fieldName].trim().length === 0) {
      throw new HttpError(500, `Python provisioner response is missing "${fieldName}".`);
    }
  }

  if (
    typeof parsed.port !== "number" ||
    !Number.isInteger(parsed.port) ||
    parsed.port <= 0 ||
    parsed.port > 65535
  ) {
    throw new HttpError(500, 'Python provisioner response is missing "port".');
  }

  const profileName = parsed.profileName as string;
  const rootPath = parsed.rootPath as string;
  const configPath = parsed.configPath as string;
  const workspacePath = parsed.workspacePath as string;
  const stateDirPath = parsed.stateDirPath as string;
  const authLinkMode = parsed.authLinkMode as string;
  const modelsLinkMode = parsed.modelsLinkMode as string;
  const extensionsLinkMode = parsed.extensionsLinkMode as string;

  return {
    profileName,
    port: parsed.port,
    rootPath,
    configPath,
    workspacePath,
    stateDirPath,
    authLinkMode,
    modelsLinkMode,
    extensionsLinkMode,
  };
}

async function runProvisionerCommand(
  args: string[],
  runtimeOptions?: CreateInstanceRuntimeOptions,
): Promise<string> {
  const command = resolveUvBin(runtimeOptions);
  const cwd = resolveManagerRootDir(runtimeOptions);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new HttpError(500, `Unable to find "${command}" in PATH.`));
        return;
      }

      reject(error);
    });

    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      const message = stderr.trim() || stdout.trim() || "Python provisioner failed.";
      reject(new HttpError(500, message));
    });
  });
}

export async function createInstance(
  opts: CreateInstanceOptions,
  existingPorts: number[],
  runtimeOptions?: CreateInstanceRuntimeOptions,
): Promise<CreateInstanceResult> {
  const managerRootDir = resolveManagerRootDir(runtimeOptions);
  const homeDir = resolveHomeDir(runtimeOptions);
  const args = [
    "run",
    "--project",
    managerRootDir,
    "python",
    "-m",
    "openclaw_manager_backend.cli",
    "provision",
    "--home-dir",
    homeDir,
    "--profile-name",
    opts.profileName,
    "--display-name",
    opts.displayName,
    "--auth-link-mode",
    runtimeOptions?.authLinkMode ?? "symlink",
  ];

  if (opts.description?.trim()) {
    args.push("--description", opts.description.trim());
  }

  if (opts.model?.trim()) {
    args.push("--model", opts.model.trim());
  }

  if (opts.port !== undefined) {
    args.push("--port", String(opts.port));
  }

  if (opts.channelType) {
    args.push("--channel-type", opts.channelType);
  }

  if (opts.sandboxMode) {
    args.push("--sandbox-mode", opts.sandboxMode);
  }

  for (const port of existingPorts) {
    args.push("--existing-port", String(port));
  }

  for (const [key, value] of Object.entries(opts.channelCredentials ?? {})) {
    args.push("--channel-credential", `${key}=${value}`);
  }

  for (const tag of opts.tags ?? []) {
    if (tag.trim().length > 0) {
      args.push("--tag", tag.trim());
    }
  }

  const stdout = await runProvisionerCommand(args, runtimeOptions);
  return parseProvisionerPayload(stdout);
}

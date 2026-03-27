import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../lib/http-error";

type JsonObject = Record<string, unknown>;

const MASKED_SECRET = "***";
const writeChains = new Map<string, Promise<unknown>>();

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }

  if (!isObject(value)) {
    return value;
  }

  const cloned: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    cloned[key] = cloneValue(entry);
  }

  return cloned;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function resolveProjectConfigPath(projectPath: string): Promise<string> {
  const stateDirPath = path.join(projectPath, ".openclaw");

  if (await directoryExists(stateDirPath)) {
    return path.join(stateDirPath, "openclaw.json");
  }

  return path.join(projectPath, "openclaw.json");
}

function parseProjectConfig(raw: string, configPath: string): JsonObject {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(500, `Failed to parse OpenClaw config at ${configPath}.`);
  }

  if (!isObject(parsed)) {
    throw new HttpError(500, `OpenClaw config at ${configPath} must be a JSON object.`);
  }

  return parsed;
}

async function readProjectConfig(projectPath: string): Promise<{
  configPath: string;
  config: JsonObject;
}> {
  const configPath = await resolveProjectConfigPath(projectPath);

  try {
    const raw = await fs.readFile(configPath, "utf8");
    return {
      configPath,
      config: parseProjectConfig(raw, configPath),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        configPath,
        config: {},
      };
    }

    throw error;
  }
}

async function readConfigFile(configFilePath: string): Promise<{
  configPath: string;
  config: JsonObject;
}> {
  try {
    const raw = await fs.readFile(configFilePath, "utf8");
    return {
      configPath: configFilePath,
      config: parseProjectConfig(raw, configFilePath),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        configPath: configFilePath,
        config: {},
      };
    }

    throw error;
  }
}

async function writeProjectConfig(configPath: string, config: JsonObject): Promise<void> {
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function withConfigWriteLock<T>(
  configPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const current = writeChains.get(configPath) ?? Promise.resolve();
  const next = current.then(operation);
  const tail = next.then(
    () => undefined,
    () => undefined,
  );

  writeChains.set(configPath, tail);

  try {
    return await next;
  } finally {
    if (writeChains.get(configPath) === tail) {
      writeChains.delete(configPath);
    }
  }
}

function applyMaskedMerge(target: JsonObject, patch: JsonObject): boolean {
  let changed = false;

  for (const [key, value] of Object.entries(patch)) {
    if (value === MASKED_SECRET) {
      continue;
    }

    if (isObject(value)) {
      const currentValue = target[key];

      if (isObject(currentValue)) {
        if (applyMaskedMerge(currentValue, value)) {
          changed = true;
        }
        continue;
      }

      const nextValue: JsonObject = {};
      const nestedChanged = applyMaskedMerge(nextValue, value);
      if (nestedChanged || Object.keys(value).length === 0) {
        target[key] = nextValue;
        changed = true;
      }
      continue;
    }

    target[key] = cloneValue(value);
    changed = true;
  }

  return changed;
}

export async function getChannels(configFilePath: string): Promise<JsonObject> {
  const { config } = await readConfigFile(configFilePath);
  return isObject(config.channels) ? config.channels : {};
}

export async function updateChannel(
  configFilePath: string,
  channelType: string,
  config: JsonObject,
): Promise<void> {
  await withConfigWriteLock(configFilePath, async () => {
    const { configPath, config: projectConfig } = await readConfigFile(configFilePath);
    const channels = isObject(projectConfig.channels) ? projectConfig.channels : {};
    const channelConfig = isObject(channels[channelType]) ? channels[channelType] : {};

    applyMaskedMerge(channelConfig, config);

    channels[channelType] = channelConfig;
    projectConfig.channels = channels;

    await writeProjectConfig(configPath, projectConfig);
  });
}

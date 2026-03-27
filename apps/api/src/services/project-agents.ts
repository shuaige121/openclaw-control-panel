import fs from "node:fs/promises";
import { HttpError } from "../lib/http-error";
import type { ProjectMemoryMode, ProjectSandboxMode } from "../types/project";

type JsonObject = Record<string, unknown>;

export interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
  isDefault: boolean;
  model: string;
  memoryMode: ProjectMemoryMode;
  sandboxMode: ProjectSandboxMode;
  tools: {
    allow: string[];
    deny: string[];
  };
  workspace: string;
  boundChannels: string[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureObject(value: unknown, fallback: JsonObject = {}): JsonObject {
  return isObject(value) ? value : fallback;
}

function hasOwn(root: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(root, key);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
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

async function readConfigFile(configFilePath: string): Promise<JsonObject> {
  try {
    const raw = await fs.readFile(configFilePath, "utf8");
    return parseProjectConfig(raw, configFilePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    throw error;
  }
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readModelRef(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (isObject(value) && typeof value.primary === "string" && value.primary.trim().length > 0) {
    return value.primary.trim();
  }

  return null;
}

function readMemoryModeValue(value: unknown): ProjectMemoryMode | null {
  if (value === "normal" || value === "locked" || value === "stateless") {
    return value;
  }

  return null;
}

function readSandboxModeValue(value: unknown): ProjectSandboxMode | null {
  if (value === "non-main" || value === "all" || value === "off") {
    return value;
  }

  return null;
}

function readIdentityName(config: JsonObject): string | null {
  const identity = ensureObject(config.identity);
  return readTrimmedString(identity.name);
}

function readIdentityEmoji(config: JsonObject): string | null {
  const identity = ensureObject(config.identity);
  return readTrimmedString(identity.emoji);
}

function readMemoryMode(config: JsonObject): ProjectMemoryMode | null {
  const directMode = readMemoryModeValue(config.memoryMode);
  if (directMode) {
    return directMode;
  }

  const memory = ensureObject(config.memory);
  return readMemoryModeValue(memory.mode);
}

function readSandboxMode(config: JsonObject): ProjectSandboxMode | null {
  const directMode = readSandboxModeValue(config.sandboxMode);
  if (directMode) {
    return directMode;
  }

  const sandbox = ensureObject(config.sandbox);
  return readSandboxModeValue(sandbox.mode);
}

function readToolList(
  config: JsonObject,
  key: "allow" | "deny",
): {
  present: boolean;
  value: string[];
} {
  const tools = config.tools;
  if (!isObject(tools) || !hasOwn(tools, key)) {
    return {
      present: false,
      value: [],
    };
  }

  return {
    present: true,
    value: readStringArray(tools[key]),
  };
}

function deriveDefaultMemoryMode(config: JsonObject): ProjectMemoryMode {
  const managerMeta = ensureObject(ensureObject(config.meta).openclawManager);
  const explicitMode = readMemoryModeValue(managerMeta.memoryMode);
  if (explicitMode) {
    return explicitMode;
  }

  const plugins = ensureObject(config.plugins);
  const slots = ensureObject(plugins.slots);
  if (slots.memory === "none" || slots.memory === null) {
    return "stateless";
  }

  const agents = ensureObject(config.agents);
  const defaults = ensureObject(agents.defaults);
  const compaction = ensureObject(defaults.compaction);
  const memoryFlush = ensureObject(compaction.memoryFlush);

  if (memoryFlush.enabled === false) {
    return "locked";
  }

  return "normal";
}

function buildBoundChannelsByAgent(
  bindingsValue: unknown,
  knownChannels: ReadonlySet<string>,
): Map<string, string[]> {
  const bindings = Array.isArray(bindingsValue) ? bindingsValue : [];
  const boundChannels = new Map<string, string[]>();

  for (const entry of bindings) {
    if (!isObject(entry)) {
      continue;
    }

    const agentId = readTrimmedString(entry.agentId);
    const channel = readTrimmedString(ensureObject(entry.match).channel);

    if (!agentId || !channel || !knownChannels.has(channel)) {
      continue;
    }

    const current = boundChannels.get(agentId) ?? [];
    if (!current.includes(channel)) {
      current.push(channel);
      boundChannels.set(agentId, current);
    }
  }

  return boundChannels;
}

function buildAgentInfo(
  agentConfig: JsonObject,
  defaults: JsonObject,
  fallbackId: string,
  defaultMemoryMode: ProjectMemoryMode,
  boundChannelsByAgent: Map<string, string[]>,
): AgentInfo {
  const id = readTrimmedString(agentConfig.id) ?? fallbackId;
  const name = readIdentityName(agentConfig) ?? readIdentityName(defaults) ?? id;
  const emoji = readIdentityEmoji(agentConfig) ?? readIdentityEmoji(defaults) ?? "🤖";
  const model = readModelRef(agentConfig.model) ?? readModelRef(defaults.model) ?? "未设置";
  const memoryMode = readMemoryMode(agentConfig) ?? readMemoryMode(defaults) ?? defaultMemoryMode;
  const sandboxMode = readSandboxMode(agentConfig) ?? readSandboxMode(defaults) ?? "off";

  const defaultAllow = readToolList(defaults, "allow");
  const defaultDeny = readToolList(defaults, "deny");
  const agentAllow = readToolList(agentConfig, "allow");
  const agentDeny = readToolList(agentConfig, "deny");

  return {
    id,
    name,
    emoji,
    isDefault: agentConfig.default === true,
    model,
    memoryMode,
    sandboxMode,
    tools: {
      allow: agentAllow.present ? agentAllow.value : defaultAllow.value,
      deny: agentDeny.present ? agentDeny.value : defaultDeny.value,
    },
    workspace: readTrimmedString(agentConfig.workspace) ?? readTrimmedString(defaults.workspace) ?? "",
    boundChannels: boundChannelsByAgent.get(id) ?? [],
  };
}

export async function getAgents(configPath: string): Promise<AgentInfo[]> {
  const config = await readConfigFile(configPath);
  const agents = ensureObject(config.agents);
  const defaults = ensureObject(agents.defaults);
  const list = Array.isArray(agents.list) ? agents.list : [];
  const channels = ensureObject(config.channels);
  const knownChannels = new Set(Object.keys(channels));
  const boundChannelsByAgent = buildBoundChannelsByAgent(config.bindings, knownChannels);
  const defaultMemoryMode = readMemoryMode(defaults) ?? deriveDefaultMemoryMode(config);

  const parsedAgents = list
    .filter((entry): entry is JsonObject => isObject(entry))
    .map((entry, index) =>
      buildAgentInfo(entry, defaults, entry.default === true ? "default" : `agent-${index + 1}`, defaultMemoryMode, boundChannelsByAgent),
    );

  if (parsedAgents.length > 0) {
    return parsedAgents;
  }

  return [
    buildAgentInfo(
      {
        default: true,
        id: "default",
      },
      defaults,
      "default",
      defaultMemoryMode,
      boundChannelsByAgent,
    ),
  ];
}

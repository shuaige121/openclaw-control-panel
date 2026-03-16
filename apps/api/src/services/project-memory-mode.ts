import fs from "node:fs/promises";
import type { ProjectMemoryMode, ProjectMemoryProfile, StoredProjectRecord } from "../types/project";

type JsonObject = Record<string, unknown>;

type StoredValueBackup<T> = {
  present: boolean;
  value: T | null;
};

type MemoryModeBackup = {
  pluginSlotMemory: StoredValueBackup<string>;
  memorySearchEnabled: StoredValueBackup<boolean>;
  memoryFlushEnabled: StoredValueBackup<boolean>;
  sessionMemoryEnabled: StoredValueBackup<boolean>;
};

const MANAGER_META_KEY = "openclawManager";

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureObject(value: unknown, fallback: JsonObject = {}): JsonObject {
  return isObject(value) ? value : fallback;
}

function hasOwn(root: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(root, key);
}

function getNestedValue(root: JsonObject, path: string): { present: boolean; value: unknown } {
  const segments = path.split(".");
  let current: unknown = root;

  for (const segment of segments) {
    if (!isObject(current) || !hasOwn(current, segment)) {
      return {
        present: false,
        value: undefined,
      };
    }

    current = current[segment];
  }

  return {
    present: true,
    value: current,
  };
}

function setNestedValue(root: JsonObject, path: string, nextValue: unknown): void {
  const segments = path.split(".");
  let current = root;

  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];
    if (!isObject(child)) {
      current[segment] = {};
    }
    current = ensureObject(current[segment]);
  }

  current[segments.at(-1)!] = nextValue;
}

function deleteNestedValue(root: JsonObject, path: string): boolean {
  const segments = path.split(".");
  let current = root;

  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];
    if (!isObject(child)) {
      return false;
    }
    current = child;
  }

  const lastSegment = segments.at(-1)!;
  if (!hasOwn(current, lastSegment)) {
    return false;
  }

  delete current[lastSegment];
  return true;
}

function pruneEmptyObjects(root: JsonObject, path: string): void {
  const segments = path.split(".");

  for (let index = segments.length - 1; index > 0; index -= 1) {
    const parentPath = segments.slice(0, index).join(".");
    const childPath = segments.slice(0, index + 1).join(".");
    const parent = getNestedValue(root, parentPath).value;
    const child = getNestedValue(root, childPath).value;

    if (!isObject(parent) || !isObject(child) || Object.keys(child).length > 0) {
      return;
    }

    delete parent[segments[index]];
  }
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseBackupEntry<T extends string | boolean>(
  value: unknown,
  validator: (candidate: unknown) => candidate is T,
): StoredValueBackup<T> | null {
  if (!isObject(value) || typeof value.present !== "boolean") {
    return null;
  }

  if (value.value === null) {
    return {
      present: value.present,
      value: null,
    };
  }

  if (!validator(value.value)) {
    return null;
  }

  return {
    present: value.present,
    value: value.value,
  };
}

function parseBackup(value: unknown): MemoryModeBackup | null {
  if (!isObject(value)) {
    return null;
  }

  const pluginSlotMemory = parseBackupEntry(value.pluginSlotMemory, (candidate): candidate is string => {
    return typeof candidate === "string";
  });
  const memorySearchEnabled = parseBackupEntry(value.memorySearchEnabled, (candidate): candidate is boolean => {
    return typeof candidate === "boolean";
  });
  const memoryFlushEnabled = parseBackupEntry(value.memoryFlushEnabled, (candidate): candidate is boolean => {
    return typeof candidate === "boolean";
  });
  const sessionMemoryEnabled = parseBackupEntry(value.sessionMemoryEnabled, (candidate): candidate is boolean => {
    return typeof candidate === "boolean";
  });

  if (!pluginSlotMemory || !memorySearchEnabled || !memoryFlushEnabled || !sessionMemoryEnabled) {
    return null;
  }

  return {
    pluginSlotMemory,
    memorySearchEnabled,
    memoryFlushEnabled,
    sessionMemoryEnabled,
  };
}

function getManagerMeta(config: JsonObject): JsonObject {
  const meta = ensureObject(config.meta);
  const managerMeta = ensureObject(meta[MANAGER_META_KEY]);
  meta[MANAGER_META_KEY] = managerMeta;
  config.meta = meta;
  return managerMeta;
}

function readMetaMemoryMode(config: JsonObject): ProjectMemoryMode | null {
  const managerMeta = getManagerMeta(config);
  const rawMode = managerMeta.memoryMode;
  if (rawMode === "normal" || rawMode === "locked" || rawMode === "stateless") {
    return rawMode;
  }

  return null;
}

function readBackup(config: JsonObject): MemoryModeBackup | null {
  return parseBackup(getManagerMeta(config).memoryModeBackup);
}

function captureBackup(config: JsonObject): MemoryModeBackup {
  const pluginSlotMemory = getNestedValue(config, "plugins.slots.memory");
  const memorySearchEnabled = getNestedValue(config, "agents.defaults.memorySearch.enabled");
  const memoryFlushEnabled = getNestedValue(config, "agents.defaults.compaction.memoryFlush.enabled");
  const sessionMemoryEnabled = getNestedValue(config, "hooks.internal.entries.session-memory.enabled");

  return {
    pluginSlotMemory: {
      present: pluginSlotMemory.present,
      value: typeof pluginSlotMemory.value === "string" ? pluginSlotMemory.value : null,
    },
    memorySearchEnabled: {
      present: memorySearchEnabled.present,
      value: typeof memorySearchEnabled.value === "boolean" ? memorySearchEnabled.value : null,
    },
    memoryFlushEnabled: {
      present: memoryFlushEnabled.present,
      value: typeof memoryFlushEnabled.value === "boolean" ? memoryFlushEnabled.value : null,
    },
    sessionMemoryEnabled: {
      present: sessionMemoryEnabled.present,
      value: typeof sessionMemoryEnabled.value === "boolean" ? sessionMemoryEnabled.value : null,
    },
  };
}

function writeBackup(config: JsonObject, backup: MemoryModeBackup): void {
  const managerMeta = getManagerMeta(config);
  managerMeta.memoryModeBackup = backup;
}

function clearManagerMemoryMeta(config: JsonObject): void {
  const meta = ensureObject(config.meta);
  const managerMeta = ensureObject(meta[MANAGER_META_KEY]);

  delete managerMeta.memoryMode;
  delete managerMeta.memoryModeBackup;

  if (Object.keys(managerMeta).length === 0) {
    delete meta[MANAGER_META_KEY];
  } else {
    meta[MANAGER_META_KEY] = managerMeta;
  }

  if (Object.keys(meta).length === 0) {
    delete config.meta;
  } else {
    config.meta = meta;
  }
}

function restoreBackupValue<T extends string | boolean>(
  config: JsonObject,
  path: string,
  backup: StoredValueBackup<T>,
): void {
  if (backup.present) {
    setNestedValue(config, path, backup.value);
    return;
  }

  deleteNestedValue(config, path);
  pruneEmptyObjects(config, path);
}

function deriveMemoryMode(config: JsonObject): ProjectMemoryMode {
  const explicitMode = readMetaMemoryMode(config);
  if (explicitMode) {
    return explicitMode;
  }

  const pluginSlot = getNestedValue(config, "plugins.slots.memory").value;
  if (pluginSlot === "none" || pluginSlot === null) {
    return "stateless";
  }

  const memoryFlushEnabled = getNestedValue(config, "agents.defaults.compaction.memoryFlush.enabled").value;
  if (memoryFlushEnabled === false) {
    return "locked";
  }

  return "normal";
}

function buildMemoryProfileFromConfig(config: JsonObject): ProjectMemoryProfile {
  const mode = deriveMemoryMode(config);
  const rawPluginSlot = getNestedValue(config, "plugins.slots.memory").value;
  const effectivePluginSlot =
    mode === "stateless"
      ? null
      : typeof rawPluginSlot === "string" && rawPluginSlot.trim().length > 0
        ? rawPluginSlot.trim()
        : "memory-core";
  const sessionMemoryEnabled = toBoolean(
    getNestedValue(config, "hooks.internal.entries.session-memory.enabled").value,
    false,
  );
  const memoryFlushEnabled = toBoolean(
    getNestedValue(config, "agents.defaults.compaction.memoryFlush.enabled").value,
    true,
  );

  return {
    mode,
    canReadMemory: mode !== "stateless",
    canWriteMemory: mode === "normal",
    effectivePluginSlot,
    sessionMemoryHookEnabled: sessionMemoryEnabled,
    memoryFlushEnabled,
  };
}

async function readProjectConfig(project: StoredProjectRecord): Promise<JsonObject> {
  const raw = await fs.readFile(project.paths.configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isObject(parsed)) {
    throw new Error(`Config at ${project.paths.configPath} must be a JSON object.`);
  }

  return parsed;
}

async function writeProjectConfig(project: StoredProjectRecord, config: JsonObject): Promise<void> {
  await fs.writeFile(project.paths.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function createEmptyMemoryProfile(): ProjectMemoryProfile {
  return {
    mode: "normal",
    canReadMemory: true,
    canWriteMemory: true,
    effectivePluginSlot: "memory-core",
    sessionMemoryHookEnabled: false,
    memoryFlushEnabled: true,
  };
}

export async function readProjectMemoryProfile(project: StoredProjectRecord): Promise<ProjectMemoryProfile> {
  try {
    const config = await readProjectConfig(project);
    return buildMemoryProfileFromConfig(config);
  } catch {
    return createEmptyMemoryProfile();
  }
}

export async function updateProjectMemoryMode(
  project: StoredProjectRecord,
  mode: ProjectMemoryMode,
): Promise<{
  previousMode: ProjectMemoryMode;
  memory: ProjectMemoryProfile;
}> {
  const config = await readProjectConfig(project);
  const previousMode = deriveMemoryMode(config);
  const existingBackup = readBackup(config);
  const baselineBackup = previousMode === "normal" || !existingBackup ? captureBackup(config) : existingBackup;

  if (mode === "normal") {
    const backup = existingBackup ?? captureBackup(config);
    restoreBackupValue(config, "plugins.slots.memory", backup.pluginSlotMemory);
    restoreBackupValue(config, "agents.defaults.memorySearch.enabled", backup.memorySearchEnabled);
    restoreBackupValue(config, "agents.defaults.compaction.memoryFlush.enabled", backup.memoryFlushEnabled);
    restoreBackupValue(config, "hooks.internal.entries.session-memory.enabled", backup.sessionMemoryEnabled);
    clearManagerMemoryMeta(config);
  } else {
    writeBackup(config, baselineBackup);
    setNestedValue(config, "meta.openclawManager.memoryMode", mode);

    if (mode === "locked") {
      restoreBackupValue(config, "plugins.slots.memory", baselineBackup.pluginSlotMemory);
      restoreBackupValue(config, "agents.defaults.memorySearch.enabled", baselineBackup.memorySearchEnabled);
      setNestedValue(config, "agents.defaults.compaction.memoryFlush.enabled", false);
      setNestedValue(config, "hooks.internal.entries.session-memory.enabled", false);
    } else {
      setNestedValue(config, "plugins.slots.memory", "none");
      setNestedValue(config, "agents.defaults.memorySearch.enabled", false);
      setNestedValue(config, "agents.defaults.compaction.memoryFlush.enabled", false);
      setNestedValue(config, "hooks.internal.entries.session-memory.enabled", false);
    }
  }

  await writeProjectConfig(project, config);

  return {
    previousMode,
    memory: buildMemoryProfileFromConfig(config),
  };
}

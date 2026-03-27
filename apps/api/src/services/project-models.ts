import fs from "node:fs/promises";
import type { ProjectModelProfile, ProjectModelOption, StoredProjectRecord } from "../types/project";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureObject(value: unknown, fallback: JsonObject = {}): JsonObject {
  return isObject(value) ? value : fallback;
}

function readPrimaryModelRef(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (isObject(value) && typeof value.primary === "string" && value.primary.trim().length > 0) {
    return value.primary.trim();
  }

  return null;
}

function readFallbackRefs(value: unknown): string[] {
  if (!isObject(value) || !Array.isArray(value.fallbacks)) {
    return [];
  }

  return value.fallbacks
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function buildConfiguredModels(value: unknown): ProjectModelOption[] {
  if (!isObject(value)) {
    return [];
  }

  return Object.entries(value)
    .map(([ref, entry]) => {
      const alias =
        isObject(entry) && typeof entry.alias === "string" && entry.alias.trim().length > 0
          ? entry.alias.trim()
          : null;

      return {
        ref,
        alias,
      };
    })
    .sort((left, right) => left.ref.localeCompare(right.ref));
}

function buildModelProfileFromConfig(config: JsonObject): ProjectModelProfile {
  const agents = ensureObject(config.agents);
  const defaults = ensureObject(agents.defaults);
  const model = defaults.model;
  const configuredModels = buildConfiguredModels(defaults.models);

  return {
    primaryRef: readPrimaryModelRef(model),
    fallbackRefs: readFallbackRefs(model),
    catalogMode: isObject(defaults.models) ? "allowlist" : "open",
    configuredModels,
    lastObservedProvider: null,
    lastObservedRef: null,
    lastObservedAt: null,
  };
}

export function createEmptyModelProfile(): ProjectModelProfile {
  return {
    primaryRef: null,
    fallbackRefs: [],
    catalogMode: "open",
    configuredModels: [],
    lastObservedProvider: null,
    lastObservedRef: null,
    lastObservedAt: null,
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

export async function readProjectModelProfile(project: StoredProjectRecord): Promise<ProjectModelProfile> {
  try {
    const config = await readProjectConfig(project);
    return buildModelProfileFromConfig(config);
  } catch {
    return createEmptyModelProfile();
  }
}

export async function updateProjectPrimaryModel(
  project: StoredProjectRecord,
  modelRef: string,
): Promise<{
  previousModelRef: string | null;
  model: ProjectModelProfile;
}> {
  const normalizedModelRef = modelRef.trim();
  if (normalizedModelRef.length === 0) {
    throw new Error("modelRef must be a non-empty string.");
  }

  const config = await readProjectConfig(project);
  const agents = ensureObject(config.agents);
  const defaults = ensureObject(agents.defaults);
  const currentModel = defaults.model;
  const nextModel = isObject(currentModel) ? { ...currentModel } : {};
  const previousModelRef = readPrimaryModelRef(currentModel);

  nextModel.primary = normalizedModelRef;
  defaults.model = nextModel;

  if (isObject(defaults.models) && !Object.prototype.hasOwnProperty.call(defaults.models, normalizedModelRef)) {
    defaults.models[normalizedModelRef] = {};
  }

  agents.defaults = defaults;
  config.agents = agents;

  await writeProjectConfig(project, config);

  return {
    previousModelRef,
    model: buildModelProfileFromConfig(config),
  };
}

import fs from "node:fs/promises";
import { assertConfigFieldValid } from "./project-config-validator";
import type {
  ProjectSandboxBackend,
  ProjectSandboxMode,
  ProjectSandboxProfile,
  ProjectSandboxScope,
  ProjectSandboxWorkspaceAccess,
  StoredProjectRecord,
} from "../types/project";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    current = current[segment] as JsonObject;
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

function readSandboxMode(value: unknown): ProjectSandboxMode {
  return value === "non-main" || value === "all" ? value : "off";
}

function readSandboxBackend(value: unknown): ProjectSandboxBackend {
  return value === "ssh" || value === "openshell" ? value : "docker";
}

function readSandboxScope(value: unknown): ProjectSandboxScope {
  if (value === "session" || value === "shared") {
    return value;
  }

  return "agent";
}

function readWorkspaceAccess(value: unknown): ProjectSandboxWorkspaceAccess {
  if (value === "ro" || value === "rw") {
    return value;
  }

  return "none";
}

function readString(value: unknown): string | null {
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

function buildSandboxProfileFromConfig(config: JsonObject): ProjectSandboxProfile {
  return {
    mode: readSandboxMode(getNestedValue(config, "agents.defaults.sandbox.mode").value),
    backend: readSandboxBackend(getNestedValue(config, "agents.defaults.sandbox.backend").value),
    scope: readSandboxScope(getNestedValue(config, "agents.defaults.sandbox.scope").value),
    workspaceAccess: readWorkspaceAccess(
      getNestedValue(config, "agents.defaults.sandbox.workspaceAccess").value,
    ),
    dockerImage: readString(getNestedValue(config, "agents.defaults.sandbox.docker.image").value),
    dockerNetwork: readString(getNestedValue(config, "agents.defaults.sandbox.docker.network").value),
    toolAllow: readStringArray(getNestedValue(config, "tools.sandbox.tools.allow").value),
    toolDeny: readStringArray(getNestedValue(config, "tools.sandbox.tools.deny").value),
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

export function createEmptySandboxProfile(): ProjectSandboxProfile {
  return {
    mode: "off",
    backend: "docker",
    scope: "agent",
    workspaceAccess: "none",
    dockerImage: null,
    dockerNetwork: null,
    toolAllow: [],
    toolDeny: [],
  };
}

export async function readProjectSandboxProfile(
  project: StoredProjectRecord,
): Promise<ProjectSandboxProfile> {
  try {
    const config = await readProjectConfig(project);
    return buildSandboxProfileFromConfig(config);
  } catch {
    return createEmptySandboxProfile();
  }
}

export async function updateProjectSandboxProfile(
  project: StoredProjectRecord,
  input: {
    mode: ProjectSandboxMode;
    backend?: ProjectSandboxBackend;
    scope?: ProjectSandboxScope;
    workspaceAccess?: ProjectSandboxWorkspaceAccess;
    dockerImage?: string | null;
    dockerNetwork?: string | null;
  },
): Promise<{
  previousSandbox: ProjectSandboxProfile;
  sandbox: ProjectSandboxProfile;
}> {
  const config = await readProjectConfig(project);
  const previousSandbox = buildSandboxProfileFromConfig(config);

  assertConfigFieldValid("agents.defaults.sandbox.mode", input.mode);
  setNestedValue(config, "agents.defaults.sandbox.mode", input.mode);

  if (input.backend) {
    assertConfigFieldValid("agents.defaults.sandbox.backend", input.backend);
    setNestedValue(config, "agents.defaults.sandbox.backend", input.backend);
  }

  if (input.scope) {
    assertConfigFieldValid("agents.defaults.sandbox.scope", input.scope);
    setNestedValue(config, "agents.defaults.sandbox.scope", input.scope);
  }

  if (input.workspaceAccess) {
    assertConfigFieldValid("agents.defaults.sandbox.workspaceAccess", input.workspaceAccess);
    setNestedValue(config, "agents.defaults.sandbox.workspaceAccess", input.workspaceAccess);
  }

  if (input.dockerImage !== undefined) {
    if (input.dockerImage === null || input.dockerImage.trim().length === 0) {
      deleteNestedValue(config, "agents.defaults.sandbox.docker.image");
      pruneEmptyObjects(config, "agents.defaults.sandbox.docker.image");
    } else {
      setNestedValue(config, "agents.defaults.sandbox.docker.image", input.dockerImage.trim());
    }
  }

  if (input.dockerNetwork !== undefined) {
    if (input.dockerNetwork === null || input.dockerNetwork.trim().length === 0) {
      deleteNestedValue(config, "agents.defaults.sandbox.docker.network");
      pruneEmptyObjects(config, "agents.defaults.sandbox.docker.network");
    } else {
      setNestedValue(config, "agents.defaults.sandbox.docker.network", input.dockerNetwork.trim());
    }
  }

  await writeProjectConfig(project, config);

  return {
    previousSandbox,
    sandbox: buildSandboxProfileFromConfig(config),
  };
}

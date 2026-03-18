import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PROJECT_REGISTRY } from "../data/default-registry";
import { HttpError } from "../lib/http-error";
import { PROJECTS_REGISTRY_PATH } from "../paths";
import type {
  ProjectAuthMode,
  ProjectAuthStrategy,
  ProjectCapabilities,
  ProjectCompatibilityCheck,
  ProjectCompatibilityCheckName,
  ProjectCompatibilityProfile,
  ProjectCompatibilityStatus,
  ProjectGatewayConfig,
  ProjectGatewayBindMode,
  ProjectGatewayProtocol,
  ProjectLifecycle,
  ProjectLifecycleMode,
  ProjectPaths,
  ProjectRegistryAuth,
  ProjectRegistryData,
  StoredAuthSecretProfile,
  StoredProjectRecord,
} from "../types/project";

const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMPATIBILITY_CHECK_NAMES: ProjectCompatibilityCheckName[] = [
  "lifecycle",
  "gateway_probe",
  "web_ui",
  "config_patch",
  "hooks",
  "skills",
  "memory",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new HttpError(400, `${fieldName} must be an object.`);
  }

  return value;
}

function expectRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function expectString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string.`);
  }

  return value;
}

function expectStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be an array of strings.`);
  }

  return value.map((entry, index) => expectRequiredString(entry, `${fieldName}[${index}]`));
}

function expectBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${fieldName} must be a boolean.`);
  }

  return value;
}

function expectPort(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new HttpError(400, `${fieldName} must be an integer between 1 and 65535.`);
  }

  return value;
}

function expectProtocol(value: unknown, fieldName: string): ProjectGatewayProtocol {
  if (value !== "http" && value !== "https") {
    throw new HttpError(400, `${fieldName} must be "http" or "https".`);
  }

  return value;
}

function expectLifecycleMode(value: unknown, fieldName: string): ProjectLifecycleMode {
  if (value !== "custom_commands" && value !== "managed_openclaw") {
    throw new HttpError(
      400,
      `${fieldName} must be "custom_commands" or "managed_openclaw".`,
    );
  }

  return value;
}

function expectGatewayBindMode(value: unknown, fieldName: string): ProjectGatewayBindMode {
  if (value !== "loopback" && value !== "lan") {
    throw new HttpError(400, `${fieldName} must be "loopback" or "lan".`);
  }

  return value;
}

function expectAuthMode(value: unknown, fieldName: string): ProjectAuthMode {
  if (value !== "inherit_manager" && value !== "custom") {
    throw new HttpError(400, `${fieldName} must be "inherit_manager" or "custom".`);
  }

  return value;
}

function expectAuthStrategy(value: unknown, fieldName: string): ProjectAuthStrategy {
  if (value !== "token" && value !== "password") {
    throw new HttpError(400, `${fieldName} must be "token" or "password".`);
  }

  return value;
}

function expectCompatibilityStatus(
  value: unknown,
  fieldName: string,
): ProjectCompatibilityStatus {
  if (value !== "incompatible" && value !== "runtime_only" && value !== "full") {
    throw new HttpError(
      400,
      `${fieldName} must be "incompatible", "runtime_only", or "full".`,
    );
  }

  return value;
}

function parseProjectId(value: unknown, fieldName: string): string {
  const normalizedId = expectRequiredString(value, fieldName).toLowerCase();

  if (!PROJECT_ID_PATTERN.test(normalizedId)) {
    throw new HttpError(
      400,
      `${fieldName} must use lowercase letters, numbers, and single hyphens.`,
    );
  }

  return normalizedId;
}

function createFallbackCompatibility(): ProjectCompatibilityProfile {
  return {
    status: "runtime_only",
    reason: "No compatibility scan has been recorded yet.",
    lastScannedAt: null,
    manualOverride: null,
    checks: COMPATIBILITY_CHECK_NAMES.map((name) => ({
      name,
      supported: false,
      message: "Compatibility has not been scanned yet.",
    })),
  };
}

function parseCompatibilityCheck(
  value: unknown,
  fieldName: string,
): ProjectCompatibilityCheck {
  const object = expectObject(value, fieldName);

  return {
    name: expectCompatibilityCheckName(object.name, `${fieldName}.name`),
    supported: expectBoolean(object.supported, `${fieldName}.supported`),
    message: expectRequiredString(object.message, `${fieldName}.message`),
  };
}

function expectCompatibilityCheckName(
  value: unknown,
  fieldName: string,
): ProjectCompatibilityCheckName {
  if (typeof value !== "string" || !COMPATIBILITY_CHECK_NAMES.includes(value as ProjectCompatibilityCheckName)) {
    throw new HttpError(
      400,
      `${fieldName} must be one of ${COMPATIBILITY_CHECK_NAMES.join(", ")}.`,
    );
  }

  return value as ProjectCompatibilityCheckName;
}

function parseCompatibility(
  value: unknown,
  fieldName: string,
  defaults?: ProjectCompatibilityProfile,
): ProjectCompatibilityProfile {
  if (value === undefined) {
    return defaults ?? createFallbackCompatibility();
  }

  const object = expectObject(value, fieldName);
  const checksValue = object.checks;

  if (!Array.isArray(checksValue)) {
    throw new HttpError(400, `${fieldName}.checks must be an array.`);
  }

  const checks = checksValue.map((entry, index) =>
    parseCompatibilityCheck(entry, `${fieldName}.checks[${index}]`),
  );
  const checkNames = new Set(checks.map((entry) => entry.name));

  if (checks.length !== COMPATIBILITY_CHECK_NAMES.length || checkNames.size !== COMPATIBILITY_CHECK_NAMES.length) {
    throw new HttpError(
      400,
      `${fieldName}.checks must include ${COMPATIBILITY_CHECK_NAMES.join(", ")} exactly once.`,
    );
  }

  return {
    status: expectCompatibilityStatus(object.status, `${fieldName}.status`),
    reason: expectRequiredString(object.reason, `${fieldName}.reason`),
    lastScannedAt:
      object.lastScannedAt === null
        ? null
        : object.lastScannedAt === undefined
          ? defaults?.lastScannedAt ?? null
          : expectRequiredString(object.lastScannedAt, `${fieldName}.lastScannedAt`),
    manualOverride:
      object.manualOverride === undefined || object.manualOverride === null
        ? defaults?.manualOverride ?? null
        : expectCompatibilityStatus(object.manualOverride, `${fieldName}.manualOverride`),
    checks: COMPATIBILITY_CHECK_NAMES.map((name) => {
      const check = checks.find((entry) => entry.name === name);
      if (!check) {
        throw new HttpError(400, `${fieldName}.checks is missing ${name}.`);
      }

      return check;
    }),
  };
}

function parsePaths(value: unknown, fieldName: string): ProjectPaths {
  const object = expectObject(value, fieldName);

  return {
    rootPath: expectRequiredString(object.rootPath, `${fieldName}.rootPath`),
    configPath: expectRequiredString(object.configPath, `${fieldName}.configPath`),
    workspacePath: expectRequiredString(object.workspacePath, `${fieldName}.workspacePath`),
  };
}

function parseGateway(value: unknown, fieldName: string): ProjectGatewayConfig {
  const object = expectObject(value, fieldName);

  return {
    protocol: expectProtocol(object.protocol ?? "http", `${fieldName}.protocol`),
    host: expectRequiredString(object.host, `${fieldName}.host`),
    port: expectPort(object.port, `${fieldName}.port`),
  };
}

function parsePositiveInteger(
  value: unknown,
  fieldName: string,
  minimum = 1,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new HttpError(400, `${fieldName} must be an integer greater than or equal to ${minimum}.`);
  }

  return value;
}

function parseLifecycle(
  value: unknown,
  fieldName: string,
  defaults?: ProjectLifecycle,
): ProjectLifecycle {
  const object = value === undefined ? {} : expectObject(value, fieldName);
  const mode =
    object.mode === undefined
      ? defaults?.mode ?? "custom_commands"
      : expectLifecycleMode(object.mode, `${fieldName}.mode`);

  if (mode === "managed_openclaw") {
    const current = defaults?.mode === "managed_openclaw" ? defaults : undefined;

    return {
      mode,
      nodePath:
        object.nodePath === undefined
          ? current?.nodePath ?? null
          : object.nodePath === null
            ? null
            : expectRequiredString(object.nodePath, `${fieldName}.nodePath`),
      cliPath:
        object.cliPath === undefined
          ? current?.cliPath ?? null
          : object.cliPath === null
            ? null
            : expectRequiredString(object.cliPath, `${fieldName}.cliPath`),
      bind:
        object.bind === undefined
          ? current?.bind ?? "loopback"
          : expectGatewayBindMode(object.bind, `${fieldName}.bind`),
      allowUnconfigured:
        object.allowUnconfigured === undefined
          ? current?.allowUnconfigured ?? true
          : expectBoolean(object.allowUnconfigured, `${fieldName}.allowUnconfigured`),
      startupTimeoutMs:
        object.startupTimeoutMs === undefined
          ? current?.startupTimeoutMs ?? 15_000
          : parsePositiveInteger(object.startupTimeoutMs, `${fieldName}.startupTimeoutMs`, 1000),
    };
  }

  const current = defaults?.mode === "custom_commands" ? defaults : undefined;

  return {
    mode,
    startCommand:
      object.startCommand === undefined
        ? current?.startCommand ?? ""
        : expectString(object.startCommand, `${fieldName}.startCommand`),
    stopCommand:
      object.stopCommand === undefined
        ? current?.stopCommand ?? ""
        : expectString(object.stopCommand, `${fieldName}.stopCommand`),
    restartCommand:
      object.restartCommand === undefined
        ? current?.restartCommand ?? ""
        : expectString(object.restartCommand, `${fieldName}.restartCommand`),
  };
}

function parseCapabilities(
  value: unknown,
  fieldName: string,
  defaults?: ProjectCapabilities,
): ProjectCapabilities {
  const object = value === undefined ? {} : expectObject(value, fieldName);

  return {
    bulkHooks:
      object.bulkHooks === undefined
        ? defaults?.bulkHooks ?? true
        : expectBoolean(object.bulkHooks, `${fieldName}.bulkHooks`),
    bulkSkills:
      object.bulkSkills === undefined
        ? defaults?.bulkSkills ?? true
        : expectBoolean(object.bulkSkills, `${fieldName}.bulkSkills`),
    bulkMemory:
      object.bulkMemory === undefined
        ? defaults?.bulkMemory ?? true
        : expectBoolean(object.bulkMemory, `${fieldName}.bulkMemory`),
    bulkConfigPatch:
      object.bulkConfigPatch === undefined
        ? defaults?.bulkConfigPatch ?? true
        : expectBoolean(object.bulkConfigPatch, `${fieldName}.bulkConfigPatch`),
  };
}

function parseStoredAuthProfile(value: unknown, fieldName: string): StoredAuthSecretProfile {
  const object = expectObject(value, fieldName);

  return {
    strategy: expectAuthStrategy(object.strategy, `${fieldName}.strategy`),
    label: expectRequiredString(object.label, `${fieldName}.label`),
    secret: expectRequiredString(object.secret, `${fieldName}.secret`),
  };
}

function parseProjectAuth(value: unknown, fieldName: string): ProjectRegistryAuth {
  const object = expectObject(value, fieldName);
  const mode = expectAuthMode(object.mode, `${fieldName}.mode`);

  if (mode === "inherit_manager") {
    return { mode };
  }

  return {
    mode,
    strategy: expectAuthStrategy(object.strategy, `${fieldName}.strategy`),
    label: expectRequiredString(object.label, `${fieldName}.label`),
    secret: expectRequiredString(object.secret, `${fieldName}.secret`),
  };
}

function parseProjectRecord(value: unknown, fieldName: string): StoredProjectRecord {
  const object = expectObject(value, fieldName);

  return {
    id: parseProjectId(object.id, `${fieldName}.id`),
    name: expectRequiredString(object.name, `${fieldName}.name`),
    description:
      object.description === undefined ? "" : expectString(object.description, `${fieldName}.description`),
    gateway: parseGateway(object.gateway, `${fieldName}.gateway`),
    tags: object.tags === undefined ? [] : expectStringArray(object.tags, `${fieldName}.tags`),
    paths: parsePaths(object.paths, `${fieldName}.paths`),
    auth: parseProjectAuth(object.auth, `${fieldName}.auth`),
    lifecycle: parseLifecycle(object.lifecycle, `${fieldName}.lifecycle`),
    capabilities: parseCapabilities(object.capabilities, `${fieldName}.capabilities`),
    compatibility: parseCompatibility(object.compatibility, `${fieldName}.compatibility`),
  };
}

function parseRegistryData(value: unknown): ProjectRegistryData {
  const object = expectObject(value, "registry");
  const version = object.version;

  if (version !== 1) {
    throw new HttpError(500, "Unsupported project registry version.");
  }

  if (!Array.isArray(object.projects)) {
    throw new HttpError(500, "registry.projects must be an array.");
  }

  const projects = object.projects.map((project, index) =>
    parseProjectRecord(project, `registry.projects[${index}]`),
  );
  const uniqueIds = new Set(projects.map((project) => project.id));

  if (uniqueIds.size !== projects.length) {
    throw new HttpError(500, "Duplicate project ids found in the registry.");
  }

  return {
    version: 1,
    managerAuth: parseStoredAuthProfile(object.managerAuth, "registry.managerAuth"),
    projects,
  };
}

function applyGatewayPatch(
  current: ProjectGatewayConfig,
  value: unknown,
  fieldName: string,
): ProjectGatewayConfig {
  const object = expectObject(value, fieldName);

  return {
    protocol:
      object.protocol === undefined
        ? current.protocol
        : expectProtocol(object.protocol, `${fieldName}.protocol`),
    host: object.host === undefined ? current.host : expectRequiredString(object.host, `${fieldName}.host`),
    port: object.port === undefined ? current.port : expectPort(object.port, `${fieldName}.port`),
  };
}

function applyPathsPatch(current: ProjectPaths, value: unknown, fieldName: string): ProjectPaths {
  const object = expectObject(value, fieldName);

  return {
    rootPath:
      object.rootPath === undefined
        ? current.rootPath
        : expectRequiredString(object.rootPath, `${fieldName}.rootPath`),
    configPath:
      object.configPath === undefined
        ? current.configPath
        : expectRequiredString(object.configPath, `${fieldName}.configPath`),
    workspacePath:
      object.workspacePath === undefined
        ? current.workspacePath
        : expectRequiredString(object.workspacePath, `${fieldName}.workspacePath`),
  };
}

function applyAuthPatch(
  current: ProjectRegistryAuth,
  value: unknown,
  fieldName: string,
): ProjectRegistryAuth {
  const object = expectObject(value, fieldName);
  const nextMode =
    object.mode === undefined ? current.mode : expectAuthMode(object.mode, `${fieldName}.mode`);

  if (nextMode === "inherit_manager") {
    return {
      mode: nextMode,
    };
  }

  const base =
    current.mode === "custom"
      ? current
      : {
          mode: "custom" as const,
          strategy: "token" as const,
          label: "项目自定义 token",
          secret: "",
        };

  const nextAuth: ProjectRegistryAuth = {
    mode: nextMode,
    strategy:
      object.strategy === undefined
        ? base.strategy
        : expectAuthStrategy(object.strategy, `${fieldName}.strategy`),
    label: object.label === undefined ? base.label : expectRequiredString(object.label, `${fieldName}.label`),
    secret:
      object.secret === undefined ? base.secret : expectRequiredString(object.secret, `${fieldName}.secret`),
  };

  if (nextAuth.secret.length === 0) {
    throw new HttpError(400, `${fieldName}.secret must be provided for custom auth.`);
  }

  return nextAuth;
}

function applyProjectPatch(current: StoredProjectRecord, value: unknown): StoredProjectRecord {
  const object = expectObject(value, "project");

  return {
    id: current.id,
    name: object.name === undefined ? current.name : expectRequiredString(object.name, "project.name"),
    description:
      object.description === undefined ? current.description : expectString(object.description, "project.description"),
    gateway:
      object.gateway === undefined
        ? current.gateway
        : applyGatewayPatch(current.gateway, object.gateway, "project.gateway"),
    tags: object.tags === undefined ? current.tags : expectStringArray(object.tags, "project.tags"),
    paths:
      object.paths === undefined ? current.paths : applyPathsPatch(current.paths, object.paths, "project.paths"),
    auth: object.auth === undefined ? current.auth : applyAuthPatch(current.auth, object.auth, "project.auth"),
    lifecycle: parseLifecycle(object.lifecycle, "project.lifecycle", current.lifecycle),
    capabilities: parseCapabilities(object.capabilities, "project.capabilities", current.capabilities),
    compatibility:
      object.compatibility === undefined
        ? current.compatibility
        : parseCompatibility(object.compatibility, "project.compatibility", current.compatibility),
  };
}

export class ProjectRegistryService {
  private readonly registryPath: string;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(registryPath = PROJECTS_REGISTRY_PATH) {
    this.registryPath = registryPath;
  }

  getRegistryPath(): string {
    return this.registryPath;
  }

  async readRegistry(): Promise<ProjectRegistryData> {
    await this.ensureRegistryFile();
    const raw = await fs.readFile(this.registryPath, "utf8");

    return parseRegistryData(JSON.parse(raw) as unknown);
  }

  async getProject(projectId: string): Promise<StoredProjectRecord> {
    const normalizedId = parseProjectId(projectId, "projectId");
    const registry = await this.readRegistry();
    const project = registry.projects.find((entry) => entry.id === normalizedId);

    if (!project) {
      throw new HttpError(404, `Project "${normalizedId}" was not found.`);
    }

    return project;
  }

  async createProject(value: unknown): Promise<StoredProjectRecord> {
    return this.updateRegistry((registry) => {
      const project = parseProjectRecord(value, "project");

      if (registry.projects.some((entry) => entry.id === project.id)) {
        throw new HttpError(409, `Project "${project.id}" already exists.`);
      }

      registry.projects.push(project);
      return {
        registry,
        result: project,
      };
    });
  }

  async updateProject(projectId: string, value: unknown): Promise<StoredProjectRecord> {
    const normalizedId = parseProjectId(projectId, "projectId");

    return this.updateRegistry((registry) => {
      const index = registry.projects.findIndex((entry) => entry.id === normalizedId);

      if (index === -1) {
        throw new HttpError(404, `Project "${normalizedId}" was not found.`);
      }

      const project = applyProjectPatch(registry.projects[index], value);
      registry.projects[index] = project;

      return {
        registry,
        result: project,
      };
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    const normalizedId = parseProjectId(projectId, "projectId");

    await this.updateRegistry((registry) => {
      const index = registry.projects.findIndex((entry) => entry.id === normalizedId);

      if (index === -1) {
        throw new HttpError(404, `Project "${normalizedId}" was not found.`);
      }

      registry.projects.splice(index, 1);
      return {
        registry,
        result: undefined,
      };
    });
  }

  async updateManagerAuth(value: unknown): Promise<StoredAuthSecretProfile> {
    return this.updateRegistry((registry) => {
      const managerAuth = parseStoredAuthProfile(value, "managerAuth");
      registry.managerAuth = managerAuth;

      return {
        registry,
        result: managerAuth,
      };
    });
  }

  async updateProjectCompatibility(
    projectId: string,
    compatibility: ProjectCompatibilityProfile,
  ): Promise<StoredProjectRecord> {
    const normalizedId = parseProjectId(projectId, "projectId");
    const normalizedCompatibility = parseCompatibility(
      compatibility,
      "project.compatibility",
      createFallbackCompatibility(),
    );

    return this.updateRegistry((registry) => {
      const index = registry.projects.findIndex((entry) => entry.id === normalizedId);

      if (index === -1) {
        throw new HttpError(404, `Project "${normalizedId}" was not found.`);
      }

      registry.projects[index] = {
        ...registry.projects[index],
        compatibility: normalizedCompatibility,
      };

      return {
        registry,
        result: registry.projects[index],
      };
    });
  }

  private async ensureRegistryFile(): Promise<void> {
    await fs.mkdir(path.dirname(this.registryPath), { recursive: true });

    try {
      await fs.access(this.registryPath);
    } catch {
      await this.writeRegistry(DEFAULT_PROJECT_REGISTRY);
    }
  }

  private async writeRegistry(registry: ProjectRegistryData): Promise<void> {
    await fs.writeFile(this.registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  }

  private async updateRegistry<T>(
    updater: (registry: ProjectRegistryData) => { registry: ProjectRegistryData; result: T },
  ): Promise<T> {
    const operation = this.writeChain.then(async () => {
      const currentRegistry = await this.readRegistry();
      const draftRegistry = structuredClone(currentRegistry);
      const { registry, result } = updater(draftRegistry);
      const normalizedRegistry = parseRegistryData(registry);

      await this.writeRegistry(normalizedRegistry);

      return result;
    });

    this.writeChain = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }
}

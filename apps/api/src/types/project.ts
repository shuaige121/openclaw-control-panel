export type ProjectRuntimeStatus = "running" | "starting" | "stopped" | "error";
export type ProjectHealthStatus = "healthy" | "degraded" | "unknown" | "unhealthy";
export type ProjectAuthMode = "inherit_manager" | "custom";
export type ProjectAuthStrategy = "token" | "password";
export type ProjectGatewayProtocol = "http" | "https";
export type ProjectActionName = "start" | "stop" | "restart";
export type BulkActionName = "hooks" | "skills" | "memory" | "config";
export type HistoryEntryKind = "project_action" | "bulk_action" | "project_registry";
export type ProjectCompatibilityStatus = "incompatible" | "runtime_only" | "full";
export type ProjectCompatibilityCheckName =
  | "lifecycle"
  | "gateway_probe"
  | "web_ui"
  | "config_patch"
  | "hooks"
  | "skills"
  | "memory";
export type ProjectMemoryMode = "normal" | "locked" | "stateless";

export interface ProjectAuthProfile {
  mode: ProjectAuthMode;
  strategy: ProjectAuthStrategy;
  label: string;
  canOverride: boolean;
}

export interface ProjectPaths {
  rootPath: string;
  configPath: string;
  workspacePath: string;
}

export interface ProjectEndpoints {
  gatewayUrl: string;
  controlUiUrl: string;
  healthUrl: string;
  readyUrl: string;
}

export interface ProjectGatewayConfig {
  protocol: ProjectGatewayProtocol;
  host: string;
  port: number;
}

export interface ProjectCapabilities {
  bulkHooks: boolean;
  bulkSkills: boolean;
  bulkMemory: boolean;
  bulkConfigPatch: boolean;
}

export interface ProjectCompatibilityCheck {
  name: ProjectCompatibilityCheckName;
  supported: boolean;
  message: string;
}

export interface ProjectCompatibilityProfile {
  status: ProjectCompatibilityStatus;
  reason: string;
  lastScannedAt: string | null;
  manualOverride: ProjectCompatibilityStatus | null;
  checks: ProjectCompatibilityCheck[];
}

export interface ProjectModelOption {
  ref: string;
  alias: string | null;
}

export interface ProjectModelProfile {
  primaryRef: string | null;
  fallbackRefs: string[];
  catalogMode: "open" | "allowlist";
  configuredModels: ProjectModelOption[];
}

export interface ProjectMemoryProfile {
  mode: ProjectMemoryMode;
  canReadMemory: boolean;
  canWriteMemory: boolean;
  effectivePluginSlot: string | null;
  sessionMemoryHookEnabled: boolean;
  memoryFlushEnabled: boolean;
}

export interface ProjectLifecycleCommands {
  startCommand: string;
  stopCommand: string;
  restartCommand: string;
}

export interface StoredAuthSecretProfile {
  strategy: ProjectAuthStrategy;
  label: string;
  secret: string;
}

export type ProjectRegistryAuth =
  | {
      mode: "inherit_manager";
    }
  | ({
      mode: "custom";
    } & StoredAuthSecretProfile);

export interface StoredProjectRecord {
  id: string;
  name: string;
  description: string;
  gateway: ProjectGatewayConfig;
  tags: string[];
  paths: ProjectPaths;
  auth: ProjectRegistryAuth;
  lifecycle: ProjectLifecycleCommands;
  capabilities: ProjectCapabilities;
  compatibility: ProjectCompatibilityProfile;
}

export interface ProjectRegistryData {
  version: 1;
  managerAuth: StoredAuthSecretProfile;
  projects: StoredProjectRecord[];
}

export interface ProjectListItem {
  id: string;
  name: string;
  description: string;
  runtimeStatus: ProjectRuntimeStatus;
  healthStatus: ProjectHealthStatus;
  gatewayPort: number;
  tags: string[];
  lastSeenAt: string | null;
  paths: ProjectPaths;
  endpoints: ProjectEndpoints;
  auth: ProjectAuthProfile;
  model: ProjectModelProfile;
  memory: ProjectMemoryProfile;
  capabilities: ProjectCapabilities;
  compatibility: ProjectCompatibilityProfile;
}

export interface ManagerAuthProfile {
  strategy: ProjectAuthStrategy;
  label: string;
  inheritedProjects: number;
  overriddenProjects: number;
}

export interface ProjectListResponse {
  items: ProjectListItem[];
  summary: {
    totalProjects: number;
    runningProjects: number;
    healthyProjects: number;
    authOverrides: number;
  };
  managerAuth: ManagerAuthProfile;
  generatedAt: string;
  source: "registry";
}

export interface CommandExecutionResult {
  ok: boolean;
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface BulkActionProjectResult {
  projectId: string;
  projectName: string;
  ok: boolean;
  message: string;
}

export interface ActionHistoryProjectRef {
  id: string;
  name: string;
}

export interface ActionHistoryEntry {
  id: string;
  kind: HistoryEntryKind;
  ok: boolean;
  createdAt: string;
  projects: ActionHistoryProjectRef[];
  summary: string;
  detail: string;
  command: string | null;
  stdout: string | null;
  stderr: string | null;
  durationMs: number | null;
  actionName: string;
}

export interface ActionHistoryStoreData {
  version: 1;
  items: ActionHistoryEntry[];
}

export interface ActionHistoryListResponse {
  items: ActionHistoryEntry[];
  generatedAt: string;
  totalItems: number;
}

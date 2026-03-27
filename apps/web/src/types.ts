export type ProjectRuntimeStatus = "running" | "starting" | "stopped" | "error";
export type ProjectHealthStatus = "healthy" | "degraded" | "unknown" | "unhealthy";
export type ProjectAuthMode = "inherit_manager" | "custom";
export type ProjectAuthStrategy = "token" | "password";
export type ProjectGatewayProtocol = "http" | "https";
export type ProjectLifecycleMode = "custom_commands" | "managed_openclaw";
export type ProjectGatewayBindMode = "loopback" | "lan";
export type BulkIntent = "hooks" | "skills" | "memory" | "config";
export type ProjectActionName = "start" | "stop" | "restart";
export type HistoryEntryKind = "project_action" | "bulk_action" | "project_registry";
export type ProjectCompatibilityStatus = "incompatible" | "runtime_only" | "full";
export type ProjectMemoryMode = "normal" | "locked" | "stateless";
export type ProjectSandboxMode = "off" | "non-main" | "all";
export type ProjectSandboxBackend = "docker" | "ssh" | "openshell";
export type ProjectSandboxScope = "session" | "agent" | "shared";
export type ProjectSandboxWorkspaceAccess = "none" | "ro" | "rw";
export type ProjectHookSource = "internal";
export type ProjectSkillSource = "bundled" | "managed" | "workspace" | "config_only";
export type ProjectTemplateId =
  | "general"
  | "stateless"
  | "sandboxed"
  | "ultramarines"
  | "sisters-of-silence"
  | "iron-hands"
  | "blood-angels"
  | "dark-angels";
export type ProjectCompatibilityCheckName =
  | "lifecycle"
  | "gateway_probe"
  | "web_ui"
  | "config_patch"
  | "hooks"
  | "skills"
  | "memory";

export type ProjectPaths = {
  rootPath: string;
  configPath: string;
  workspacePath: string;
};

export type ProjectEndpoints = {
  gatewayUrl: string;
  controlUiUrl: string;
  healthUrl: string;
  readyUrl: string;
};

export type ProjectAuthProfile = {
  mode: ProjectAuthMode;
  strategy: ProjectAuthStrategy;
  label: string;
  canOverride: boolean;
};

export type ProjectCapabilities = {
  bulkHooks: boolean;
  bulkSkills: boolean;
  bulkMemory: boolean;
  bulkConfigPatch: boolean;
};

export type ProjectCompatibilityCheck = {
  name: ProjectCompatibilityCheckName;
  supported: boolean;
  message: string;
};

export type ProjectCompatibilityProfile = {
  status: ProjectCompatibilityStatus;
  reason: string;
  lastScannedAt: string | null;
  manualOverride: ProjectCompatibilityStatus | null;
  checks: ProjectCompatibilityCheck[];
};

export type ProjectModelOption = {
  ref: string;
  alias: string | null;
};

export type ProjectModelProfile = {
  primaryRef: string | null;
  fallbackRefs: string[];
  catalogMode: "open" | "allowlist";
  configuredModels: ProjectModelOption[];
};

export type ProjectMemoryProfile = {
  mode: ProjectMemoryMode;
  canReadMemory: boolean;
  canWriteMemory: boolean;
  effectivePluginSlot: string | null;
  sessionMemoryHookEnabled: boolean;
  memoryFlushEnabled: boolean;
};

export type ProjectSandboxProfile = {
  mode: ProjectSandboxMode;
  backend: ProjectSandboxBackend;
  scope: ProjectSandboxScope;
  workspaceAccess: ProjectSandboxWorkspaceAccess;
  dockerImage: string | null;
  dockerNetwork: string | null;
  toolAllow: string[];
  toolDeny: string[];
};

export type ProjectHookEntry = {
  name: string;
  enabled: boolean;
  source: ProjectHookSource;
};

export type ProjectHooksProfile = {
  entries: ProjectHookEntry[];
  enabledCount: number;
};

export type ProjectSkillCatalogEntry = {
  name: string;
  source: ProjectSkillSource;
  official: boolean;
  path: string | null;
};

export type ProjectConfiguredSkillEntry = ProjectSkillCatalogEntry & {
  enabled: boolean;
};

export type ProjectSkillsProfile = {
  configuredEntries: ProjectConfiguredSkillEntry[];
  catalogEntries: ProjectSkillCatalogEntry[];
  enabledCount: number;
  officialCount: number;
  customCount: number;
};

export type ProjectTemplateDefinition = {
  id: ProjectTemplateId;
  name: string;
  summary: string;
  description: string;
  recommendedTags: string[];
  memoryMode: ProjectMemoryMode;
  sandbox: {
    mode: ProjectSandboxMode;
    backend: ProjectSandboxBackend;
    scope: ProjectSandboxScope;
    workspaceAccess: ProjectSandboxWorkspaceAccess;
  };
  notes: string[];
};

export type ProjectListItem = {
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
  sandbox: ProjectSandboxProfile;
  hooks: ProjectHooksProfile;
  skills: ProjectSkillsProfile;
  capabilities: ProjectCapabilities;
  compatibility: ProjectCompatibilityProfile;
};

export type ManagerAuthProfile = {
  strategy: ProjectAuthStrategy;
  label: string;
  inheritedProjects: number;
  overriddenProjects: number;
};

export type ProjectsResponse = {
  items: ProjectListItem[];
  summary: {
    totalProjects: number;
    runningProjects: number;
    healthyProjects: number;
    authOverrides: number;
  };
  managerAuth: ManagerAuthProfile;
  generatedAt: string;
  source: string;
};

export type ProjectGateway = {
  protocol: ProjectGatewayProtocol;
  host: string;
  port: number;
};

export type ProjectCustomLifecycle = {
  mode: "custom_commands";
  startCommand: string;
  stopCommand: string;
  restartCommand: string;
};

export type ProjectManagedOpenClawLifecycle = {
  mode: "managed_openclaw";
  nodePath: string | null;
  cliPath: string | null;
  bind: ProjectGatewayBindMode;
  allowUnconfigured: boolean;
  startupTimeoutMs: number;
};

export type ProjectLifecycle = ProjectCustomLifecycle | ProjectManagedOpenClawLifecycle;

export type ProjectRegistryView = {
  id: string;
  name: string;
  description: string;
  gateway: ProjectGateway;
  tags: string[];
  paths: ProjectPaths;
  lifecycle: ProjectLifecycle;
  capabilities: ProjectCapabilities;
  auth: ProjectAuthProfile;
  model: ProjectModelProfile;
  memory: ProjectMemoryProfile;
  sandbox: ProjectSandboxProfile;
  hooks: ProjectHooksProfile;
  skills: ProjectSkillsProfile;
  compatibility: ProjectCompatibilityProfile;
};

export type ProjectDetailResponse = {
  item: ProjectListItem;
  registry: ProjectRegistryView;
  managerAuth: ManagerAuthProfile;
};

export type ProjectUpsertPayload = {
  id: string;
  name: string;
  description: string;
  gateway: ProjectGateway;
  tags: string[];
  paths: ProjectPaths;
  auth:
    | {
        mode: "inherit_manager";
      }
    | {
        mode: "custom";
        strategy: ProjectAuthStrategy;
        label: string;
        secret?: string;
      };
  lifecycle: ProjectLifecycle;
  capabilities: ProjectCapabilities;
};

export type ProjectCreateResponse = {
  ok: true;
  created?: boolean;
  projectId: string;
  registryPath: string;
  instance?: {
    profileName: string;
    port: number;
    rootPath: string;
    configPath: string;
    workspacePath: string;
    stateDirPath: string;
    authLinkMode?: string;
    modelsLinkMode?: string;
    extensionsLinkMode?: string;
  };
  appliedTemplateId?: ProjectTemplateId | null;
};

export type ProjectActionResponse = {
  ok: boolean;
  action: ProjectActionName;
  projectId: string;
  result: {
    ok: boolean;
    command: string;
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    durationMs: number;
  };
  item: ProjectListItem | null;
};

export type ProjectCompatibilityScanResponse = {
  ok: boolean;
  projectId: string;
  compatibility: ProjectCompatibilityProfile;
};

export type ProjectModelUpdateResponse = {
  ok: boolean;
  projectId: string;
  previousModelRef: string | null;
  restartTriggered: boolean;
  result: {
    ok: boolean;
    command: string;
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    durationMs: number;
  } | null;
  model: ProjectModelProfile;
  item: ProjectListItem | null;
};

export type ProjectMemoryModeUpdateResponse = {
  ok: boolean;
  projectId: string;
  previousMode: ProjectMemoryMode;
  restartTriggered: boolean;
  result: {
    ok: boolean;
    command: string;
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    durationMs: number;
  } | null;
  memory: ProjectMemoryProfile;
  item: ProjectListItem | null;
};

export type ProjectTemplateListResponse = {
  items: ProjectTemplateDefinition[];
  generatedAt: string;
};

export type ProjectTemplateApplyResponse = {
  ok: boolean;
  projectId: string;
  templateId: ProjectTemplateId;
  restartTriggered: boolean;
  result: {
    ok: boolean;
    command: string;
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    durationMs: number;
  } | null;
  memory: ProjectMemoryProfile;
  sandbox: ProjectSandboxProfile;
  item: ProjectListItem | null;
};

export type BulkActionExecutePayload =
  | {
      action: "hooks";
      projectIds: string[];
      payload: {
        mode: "enable" | "disable";
        hookName: string;
      };
    }
  | {
      action: "skills";
      projectIds: string[];
      payload: {
        mode: "enable" | "disable";
        skillName: string;
      };
    }
  | {
      action: "memory";
      projectIds: string[];
      payload:
        | {
            mode: "append";
            content: string;
            blockId?: string;
          }
        | {
            mode: "remove";
            blockId: string;
          };
    }
  | {
      action: "config";
      projectIds: string[];
      payload:
        | {
            mode: "set";
            path: string;
            value: unknown;
          }
        | {
            mode: "delete";
            path: string;
          };
    };

export type BulkActionResponse = {
  ok: boolean;
  action: BulkIntent;
  projectIds: string[];
  results: Array<{
    projectId: string;
    projectName: string;
    ok: boolean;
    message: string;
  }>;
};

export type ActionHistoryEntry = {
  id: string;
  kind: HistoryEntryKind;
  ok: boolean;
  createdAt: string;
  projects: Array<{
    id: string;
    name: string;
  }>;
  summary: string;
  detail: string;
  command: string | null;
  stdout: string | null;
  stderr: string | null;
  durationMs: number | null;
  actionName: string;
};

export type ActionHistoryResponse = {
  items: ActionHistoryEntry[];
  generatedAt: string;
  totalItems: number;
};

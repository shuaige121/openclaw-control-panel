import fs from "node:fs/promises";
import path from "node:path";
import { buildProjectEndpoints, probeHttpUrl, probeTcpPort } from "./project-probe";
import { inspectManagedOpenClawRuntime } from "./project-managed-openclaw";
import type {
  ProjectCompatibilityCheck,
  ProjectCompatibilityCheckName,
  ProjectCompatibilityProfile,
  ProjectCompatibilityStatus,
  StoredProjectRecord,
} from "../types/project";

const COMPATIBILITY_CHECK_ORDER: ProjectCompatibilityCheckName[] = [
  "lifecycle",
  "gateway_probe",
  "web_ui",
  "config_patch",
  "hooks",
  "skills",
  "memory",
];

const CONTROL_UI_MARKERS = [
  "src/gateway/control-ui.ts",
  "src/gateway/control-ui",
  "docs/web/dashboard.md",
] as const;

type ConfigReadResult = {
  config: Record<string, unknown> | null;
  error: string | null;
};

type LiveGatewayProbe = {
  portOpen: boolean;
  healthOk: boolean;
  readyOk: boolean;
  webReached: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createCheck(
  name: ProjectCompatibilityCheckName,
  supported: boolean,
  message: string,
): ProjectCompatibilityCheck {
  return {
    name,
    supported,
    message,
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findControlUiMarker(rootPath: string): Promise<string | null> {
  for (const marker of CONTROL_UI_MARKERS) {
    const markerPath = path.join(rootPath, marker);
    if (await pathExists(markerPath)) {
      return marker;
    }
  }

  return null;
}

async function readProjectConfig(configPath: string): Promise<ConfigReadResult> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!isObject(parsed)) {
      return {
        config: null,
        error: "Config JSON is not an object.",
      };
    }

    return {
      config: parsed,
      error: null,
    };
  } catch (error) {
    return {
      config: null,
      error: error instanceof Error ? error.message : "Config file could not be read.",
    };
  }
}

function readObjectAtPath(
  source: Record<string, unknown> | null,
  segments: string[],
): Record<string, unknown> | null {
  let current: unknown = source;

  for (const segment of segments) {
    if (!isObject(current) || !(segment in current)) {
      return null;
    }

    current = current[segment];
  }

  return isObject(current) ? current : null;
}

async function probeLiveGateway(project: StoredProjectRecord): Promise<LiveGatewayProbe> {
  const endpoints = buildProjectEndpoints(project);
  const portOpen = await probeTcpPort(project.gateway.host, project.gateway.port, 1200);

  if (!portOpen) {
    return {
      portOpen: false,
      healthOk: false,
      readyOk: false,
      webReached: false,
    };
  }

  const [healthProbe, readyProbe, webProbe] = await Promise.all([
    probeHttpUrl(endpoints.healthUrl, 1600),
    probeHttpUrl(endpoints.readyUrl, 1600),
    probeHttpUrl(endpoints.controlUiUrl, 1600),
  ]);

  return {
    portOpen: true,
    healthOk: healthProbe.ok,
    readyOk: readyProbe.ok,
    webReached: webProbe.reached,
  };
}

function deriveStatus(checks: ProjectCompatibilityCheck[]): ProjectCompatibilityStatus {
  const byName = new Map(checks.map((check) => [check.name, check]));
  const lifecycle = byName.get("lifecycle")?.supported ?? false;
  const configPatch = byName.get("config_patch")?.supported ?? false;

  if (!lifecycle || !configPatch) {
    return "incompatible";
  }

  if (checks.every((check) => check.supported)) {
    return "full";
  }

  return "runtime_only";
}

function deriveReason(status: ProjectCompatibilityStatus, checks: ProjectCompatibilityCheck[]): string {
  const missingChecks = checks.filter((check) => !check.supported).map((check) => check.name);

  if (status === "full") {
    return "Project matches the current OpenClaw layout and Control Panel feature set.";
  }

  if (status === "incompatible") {
    if (missingChecks.includes("config_patch")) {
      return "Config file is missing or unreadable, so Control Panel cannot safely patch this project.";
    }

    return "Lifecycle or filesystem assumptions do not match the current Control Panel integration model.";
  }

  return `Project can be managed at runtime, but these areas are partial: ${missingChecks.join(", ")}.`;
}

export async function scanProjectCompatibility(
  project: StoredProjectRecord,
): Promise<ProjectCompatibilityProfile> {
  const [
    rootExists,
    workspaceExists,
    configResult,
    controlUiMarker,
    liveGateway,
    managedLifecycle,
  ] = await Promise.all([
    pathExists(project.paths.rootPath),
    pathExists(project.paths.workspacePath),
    readProjectConfig(project.paths.configPath),
    findControlUiMarker(project.paths.rootPath),
    probeLiveGateway(project),
    project.lifecycle.mode === "managed_openclaw"
      ? inspectManagedOpenClawRuntime(project)
      : Promise.resolve({
          supported: [
            project.lifecycle.startCommand,
            project.lifecycle.stopCommand,
            project.lifecycle.restartCommand,
          ].every((command) => command.trim().length > 0),
          message: [
            project.lifecycle.startCommand,
            project.lifecycle.stopCommand,
            project.lifecycle.restartCommand,
          ].every((command) => command.trim().length > 0)
            ? "Start, stop, and restart commands are all present."
            : "One or more lifecycle commands are missing.",
        }),
  ]);

  const lifecycleReady = managedLifecycle.supported;
  const configPatchReady = configResult.config !== null;
  const hooksEntries = readObjectAtPath(configResult.config, ["hooks", "internal", "entries"]);
  const skillsEntries = readObjectAtPath(configResult.config, ["skills", "entries"]);

  const checks = COMPATIBILITY_CHECK_ORDER.map((name): ProjectCompatibilityCheck => {
    switch (name) {
      case "lifecycle":
        return createCheck(
          name,
          lifecycleReady,
          managedLifecycle.message,
        );
      case "gateway_probe":
        if (liveGateway.portOpen) {
          const reachable = liveGateway.healthOk || liveGateway.readyOk;
          return createCheck(
            name,
            reachable,
            reachable
              ? "Standard /healthz or /readyz endpoint responded."
              : "Gateway port is open, but standard probe endpoints did not respond.",
          );
        }

        return createCheck(
          name,
          lifecycleReady && rootExists,
          lifecycleReady && rootExists
            ? "Gateway is offline during this scan; runtime probe will rely on standard endpoint layout once started."
            : "Gateway is offline and the project root or lifecycle commands do not look compatible.",
        );
      case "web_ui":
        if (liveGateway.portOpen) {
          return createCheck(
            name,
            liveGateway.webReached,
            liveGateway.webReached
              ? "Control UI responded over HTTP."
              : "Gateway is up, but the Control UI root page did not respond.",
          );
        }

        return createCheck(
          name,
          controlUiMarker !== null,
          controlUiMarker !== null
            ? `Detected Control UI marker at ${controlUiMarker}.`
            : "No standard Control UI source marker was found under the project root.",
        );
      case "config_patch":
        return createCheck(
          name,
          configPatchReady,
          configPatchReady ? "Config file is readable JSON." : configResult.error ?? "Config file is not usable.",
        );
      case "hooks":
        return createCheck(
          name,
          project.capabilities.bulkHooks && hooksEntries !== null,
          !project.capabilities.bulkHooks
            ? "Bulk hook actions are disabled in the Control Panel registry."
            : hooksEntries !== null
              ? "hooks.internal.entries is present."
              : "hooks.internal.entries is missing from config.",
        );
      case "skills":
        return createCheck(
          name,
          project.capabilities.bulkSkills && skillsEntries !== null,
          !project.capabilities.bulkSkills
            ? "Bulk skill actions are disabled in the Control Panel registry."
            : skillsEntries !== null
              ? "skills.entries is present."
              : "skills.entries is missing from config.",
        );
      case "memory":
        return createCheck(
          name,
          project.capabilities.bulkMemory && workspaceExists,
          !project.capabilities.bulkMemory
            ? "Bulk memory actions are disabled in the Control Panel registry."
            : workspaceExists
              ? "Workspace path exists; Control Panel can append or remove tagged memory blocks."
              : "Workspace path does not exist.",
        );
    }
  });

  const status = deriveStatus(checks);

  return {
    status,
    reason: deriveReason(status, checks),
    lastScannedAt: new Date().toISOString(),
    manualOverride: project.compatibility.manualOverride,
    checks,
  };
}

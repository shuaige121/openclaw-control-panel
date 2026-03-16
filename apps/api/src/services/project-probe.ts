import net from "node:net";
import { readProjectMemoryProfile } from "./project-memory-mode";
import { readProjectModelProfile } from "./project-models";
import type {
  ManagerAuthProfile,
  ProjectAuthProfile,
  ProjectEndpoints,
  ProjectHealthStatus,
  ProjectListItem,
  ProjectListResponse,
  ProjectRegistryData,
  ProjectRuntimeStatus,
  StoredProjectRecord,
} from "../types/project";

type ProbeResult = {
  runtimeStatus: ProjectRuntimeStatus;
  healthStatus: ProjectHealthStatus;
  lastSeenAt: string | null;
};

type HttpProbe = {
  reached: boolean;
  ok: boolean;
  contentType: string | null;
};

export function buildProjectEndpoints(project: StoredProjectRecord): ProjectEndpoints {
  const origin = `${project.gateway.protocol}://${project.gateway.host}:${project.gateway.port}`;

  return {
    gatewayUrl: origin,
    controlUiUrl: `${origin}/`,
    healthUrl: `${origin}/healthz`,
    readyUrl: `${origin}/readyz`,
  };
}

function buildAuthProfile(
  project: StoredProjectRecord,
  registry: ProjectRegistryData,
): ProjectAuthProfile {
  if (project.auth.mode === "inherit_manager") {
    return {
      mode: "inherit_manager",
      strategy: registry.managerAuth.strategy,
      label: `继承${registry.managerAuth.label}`,
      canOverride: true,
    };
  }

  return {
    mode: "custom",
    strategy: project.auth.strategy,
    label: project.auth.label,
    canOverride: true,
  };
}

function buildManagerAuthProfile(registry: ProjectRegistryData): ManagerAuthProfile {
  const overriddenProjects = registry.projects.filter((project) => project.auth.mode === "custom").length;

  return {
    strategy: registry.managerAuth.strategy,
    label: registry.managerAuth.label,
    inheritedProjects: registry.projects.length - overriddenProjects,
    overriddenProjects,
  };
}

export async function probeHttpUrl(url: string, timeoutMs: number): Promise<HttpProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/plain,*/*",
      },
    });
    const contentType = response.headers.get("content-type");
    const looksLikeHtml = contentType?.toLowerCase().includes("text/html") ?? false;

    return {
      reached: true,
      ok: response.ok && !looksLikeHtml,
      contentType,
    };
  } catch {
    return {
      reached: false,
      ok: false,
      contentType: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({
      host,
      port,
    });

    let settled = false;
    const finish = (isOpen: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(isOpen);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function probeProjectRuntime(project: StoredProjectRecord): Promise<ProbeResult> {
  const endpoints = buildProjectEndpoints(project);
  const portOpen = await probeTcpPort(project.gateway.host, project.gateway.port, 1200);

  if (!portOpen) {
    return {
      runtimeStatus: "stopped",
      healthStatus: "unknown",
      lastSeenAt: null,
    };
  }

  const [healthProbe, readyProbe] = await Promise.all([
    probeHttpUrl(endpoints.healthUrl, 1800),
    probeHttpUrl(endpoints.readyUrl, 1800),
  ]);

  const now = new Date().toISOString();

  if (healthProbe.ok && readyProbe.ok) {
    return {
      runtimeStatus: "running",
      healthStatus: "healthy",
      lastSeenAt: now,
    };
  }

  if (healthProbe.ok || readyProbe.ok) {
    return {
      runtimeStatus: "running",
      healthStatus: "degraded",
      lastSeenAt: now,
    };
  }

  if (healthProbe.reached || readyProbe.reached) {
    return {
      runtimeStatus: "running",
      healthStatus: "degraded",
      lastSeenAt: now,
    };
  }

  return {
    runtimeStatus: "running",
    healthStatus: "unknown",
    lastSeenAt: now,
  };
}

export async function buildProjectListResponse(
  registry: ProjectRegistryData,
): Promise<ProjectListResponse> {
  const items = await Promise.all(
    registry.projects.map(async (project): Promise<ProjectListItem> => {
      const [probe, model, memory] = await Promise.all([
        probeProjectRuntime(project),
        readProjectModelProfile(project),
        readProjectMemoryProfile(project),
      ]);

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        runtimeStatus: probe.runtimeStatus,
        healthStatus: probe.healthStatus,
        gatewayPort: project.gateway.port,
        tags: project.tags,
        lastSeenAt: probe.lastSeenAt,
        paths: project.paths,
        endpoints: buildProjectEndpoints(project),
        auth: buildAuthProfile(project, registry),
        model,
        memory,
        capabilities: project.capabilities,
        compatibility: project.compatibility,
      };
    }),
  );

  const summary = {
    totalProjects: items.length,
    runningProjects: items.filter((item) => item.runtimeStatus === "running").length,
    healthyProjects: items.filter((item) => item.healthStatus === "healthy").length,
    authOverrides: items.filter((item) => item.auth.mode === "custom").length,
  };

  return {
    items,
    summary,
    managerAuth: buildManagerAuthProfile(registry),
    generatedAt: new Date().toISOString(),
    source: "registry",
  };
}

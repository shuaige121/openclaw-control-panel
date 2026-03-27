import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { TestContext } from "node:test";
import request from "supertest";
import { createServer } from "../src/server";
import { ActionHistoryService } from "../src/services/action-history";
import { ProjectRegistryService } from "../src/services/project-registry";
import type {
  ProjectCustomCommandLifecycle,
  ProjectLifecycle,
  ProjectRegistryData,
  StoredProjectRecord,
} from "../src/types/project";

type ProjectFixtureOptions = {
  id: string;
  name?: string;
  description?: string;
  gatewayPort?: number;
  config?: Record<string, unknown>;
  lifecycle?: ProjectLifecycle | Partial<ProjectCustomCommandLifecycle>;
};

export type ApiTestContext = {
  request: request.SuperTest<request.Test>;
  tempDir: string;
  registryPath: string;
  historyPath: string;
  readProjectConfig: (projectId: string) => Promise<Record<string, unknown>>;
  readProjectMemory: (projectId: string) => Promise<string>;
};

export async function createFakeOpenClawCli(tempDir: string): Promise<string> {
  const cliPath = path.join(tempDir, "fake-openclaw.mjs");
  const source = `
import http from "node:http";

const args = process.argv.slice(2);
let port = 0;
let bind = "loopback";

for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === "--port") {
    port = Number.parseInt(args[index + 1] ?? "0", 10);
    index += 1;
    continue;
  }
  if (value === "--bind") {
    bind = args[index + 1] ?? "loopback";
    index += 1;
  }
}

if (args[0] !== "gateway" || args[1] !== "run" || !Number.isInteger(port) || port <= 0) {
  console.error("unexpected fake openclaw invocation", args.join(" "));
  process.exit(2);
}

const host = bind === "lan" ? "0.0.0.0" : "127.0.0.1";
const server = http.createServer((request, response) => {
  if (request.url === "/healthz" || request.url === "/readyz") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end("<html><body>fake control ui</body></html>");
});

server.listen(port, host, () => {
  console.log("[fake-openclaw] listening", host, port);
});

process.on("SIGTERM", () => {
  server.close(() => {
    process.exit(0);
  });
});

setInterval(() => {}, 1000);
`;

  await writeFile(cliPath, source.trimStart(), "utf8");
  return cliPath;
}

function createDefaultConfig(port: number): Record<string, unknown> {
  return {
    gateway: {
      port,
    },
    hooks: {
      internal: {
        enabled: false,
        entries: {},
      },
    },
    skills: {
      entries: {},
    },
  };
}

export async function createProjectFixture(
  tempDir: string,
  options: ProjectFixtureOptions,
): Promise<StoredProjectRecord> {
  const rootPath = path.join(tempDir, options.id);
  const workspacePath = path.join(rootPath, "workspace");
  const configPath = path.join(rootPath, "openclaw.json");
  const controlUiMarkerPath = path.join(rootPath, "src", "gateway");
  const gatewayPort = options.gatewayPort ?? 19900;

  const lifecycle =
    options.lifecycle?.mode === "managed_openclaw"
      ? options.lifecycle
      : {
          mode: "custom_commands" as const,
          startCommand: options.lifecycle?.startCommand ?? "printf started",
          stopCommand: options.lifecycle?.stopCommand ?? "printf stopped",
          restartCommand: options.lifecycle?.restartCommand ?? "printf restarted",
        };

  await mkdir(workspacePath, { recursive: true });
  await mkdir(controlUiMarkerPath, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(options.config ?? createDefaultConfig(gatewayPort), null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(controlUiMarkerPath, "control-ui.ts"), "export {};\n", "utf8");

  return {
    id: options.id,
    name: options.name ?? options.id,
    description: options.description ?? `${options.id} project fixture`,
    gateway: {
      protocol: "http",
      host: "127.0.0.1",
      port: gatewayPort,
    },
    tags: ["test"],
    paths: {
      rootPath,
      configPath,
      workspacePath,
    },
    auth: {
      mode: "inherit_manager",
    },
    lifecycle,
    capabilities: {
      bulkHooks: true,
      bulkSkills: true,
      bulkMemory: true,
      bulkConfigPatch: true,
    },
    compatibility: {
      status: "full",
      reason: "Fixture placeholder compatibility state.",
      lastScannedAt: "2026-03-17T00:00:00.000Z",
      manualOverride: null,
      checks: [
        {
          name: "lifecycle",
          supported: true,
          message: "Fixture placeholder.",
        },
        {
          name: "gateway_probe",
          supported: true,
          message: "Fixture placeholder.",
        },
        {
          name: "web_ui",
          supported: true,
          message: "Fixture placeholder.",
        },
        {
          name: "config_patch",
          supported: true,
          message: "Fixture placeholder.",
        },
        {
          name: "hooks",
          supported: true,
          message: "Fixture placeholder.",
        },
        {
          name: "skills",
          supported: true,
          message: "Fixture placeholder.",
        },
        {
          name: "memory",
          supported: true,
          message: "Fixture placeholder.",
        },
      ],
    },
  };
}

export async function createApiTestContext(
  context: TestContext,
  options?: {
    projects?: StoredProjectRecord[];
    accessControl?: {
      allowedIps?: string[];
      trustProxy?: boolean;
    };
    instanceCreator?: {
      homeDir?: string;
      managerRootDir?: string;
      uvBin?: string;
      authLinkMode?: "symlink" | "copy";
    };
  },
): Promise<ApiTestContext> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-manager-api-test-"));
  const registryPath = path.join(tempDir, "projects.json");
  const historyPath = path.join(tempDir, "action-history.json");

  context.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const registry: ProjectRegistryData = {
    version: 1,
    managerAuth: {
      strategy: "token",
      label: "test manager token",
      secret: "test-secret",
    },
    projects: options?.projects ?? [],
  };

  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await writeFile(historyPath, `${JSON.stringify({ version: 1, items: [] }, null, 2)}\n`, "utf8");

  const registryService = new ProjectRegistryService(registryPath);
  const actionHistoryService = new ActionHistoryService(historyPath);
  const app = createServer({
    registryService,
    actionHistoryService,
    serveWeb: false,
    accessControl: options?.accessControl,
    instanceCreatorOptions: options?.instanceCreator,
  });

  return {
    request: request(app),
    tempDir,
    registryPath,
    historyPath,
    async readProjectConfig(projectId: string) {
      const raw = await readFile(path.join(tempDir, projectId, "openclaw.json"), "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    },
    async readProjectMemory(projectId: string) {
      const memoryPath = path.join(tempDir, projectId, "workspace", "MEMORY.md");
      return readFile(memoryPath, "utf8");
    },
  };
}

export function expectJsonObject(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

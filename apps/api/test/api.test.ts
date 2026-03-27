import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createInstance } from "../src/services/instance-creator";
import {
  createApiTestContext,
  createFakeOpenClawCli,
  createProjectFixture,
  expectJsonObject,
} from "./helpers";

async function createProvisionerHome(options?: {
  includeAuthProfiles?: boolean;
}): Promise<string> {
  const provisionerHome = await mkdtemp(path.join(os.tmpdir(), "openclaw-manager-home-"));
  const sharedAgentDir = path.join(provisionerHome, ".openclaw", "agents", "main", "agent");
  const sharedExtensionsDir = path.join(provisionerHome, ".openclaw", "extensions");
  await mkdir(sharedAgentDir, { recursive: true });
  await mkdir(sharedExtensionsDir, { recursive: true });
  if (options?.includeAuthProfiles !== false) {
    await writeFile(
      path.join(sharedAgentDir, "auth-profiles.json"),
      `${JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:default": {
              type: "oauth",
              provider: "openai-codex",
              access: "test-access-token",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  await writeFile(
    path.join(sharedAgentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          "openai-codex": {
            baseUrl: "https://chatgpt.com/backend-api",
            api: "openai-codex-responses",
            models: [],
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return provisionerHome;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

test("GET /api/projects returns registry-backed items and stopped probe status", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const project = await createProjectFixture(api.tempDir, {
    id: "probe-target",
    gatewayPort: 19931,
  });

  await api.request.post("/api/projects").send(project).expect(201);

  const response = await api.request.get("/api/projects").expect(200);

  assert.equal(response.body.source, "registry");
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.items[0].id, "probe-target");
  assert.equal(response.body.items[0].runtimeStatus, "stopped");
  assert.equal(response.body.items[0].healthStatus, "unknown");
  assert.equal(response.body.items[0].model.primaryRef, null);
  assert.equal(response.body.items[0].sandbox.mode, "off");
});

test("GET /api/projects marks invalid config as unhealthy with diagnostics", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const project = await createProjectFixture(api.tempDir, {
    id: "broken-config-target",
    gatewayPort: 19945,
  });

  await api.request.post("/api/projects").send(project).expect(201);
  await writeFile(project.paths.configPath, "{broken-json\n", "utf8");

  const response = await api.request.get("/api/projects").expect(200);
  const item = response.body.items.find((entry: { id: string }) => entry.id === "broken-config-target");

  assert.equal(item.runtimeStatus, "stopped");
  assert.equal(item.healthStatus, "unhealthy");
  assert.equal(Array.isArray(item.configIssues), true);
  assert.match(item.configIssues[0].message, /invalid JSON/i);
});

test("project registry CRUD routes append history entries", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });

  const fixture = await createProjectFixture(api.tempDir, {
    id: "registry-target",
    gatewayPort: 19932,
  });

  await api.request.post("/api/projects").send(fixture).expect(201);
  await api.request
    .patch("/api/projects/registry-target")
    .send({ name: "Registry Target Updated" })
    .expect(200);
  await api.request.delete("/api/projects/registry-target").expect(204);

  const history = await api.request.get("/api/actions?projectId=registry-target&limit=5").expect(200);

  assert.equal(history.body.totalItems, 3);
  assert.deepEqual(
    history.body.items.map((item: { actionName: string }) => item.actionName),
    ["project_delete", "project_update", "project_create"],
  );
});

test("provisioned instance create auto-allocates a free port, copies shared auth, and applies template", async (context) => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const provisionerHome = await createProvisionerHome();

  let occupiedPort = 18800;
  let busyPortServer: http.Server | null = null;

  while (busyPortServer === null) {
    const candidateServer = http.createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "text/plain",
      });
      response.end("busy");
    });

    const listened = await new Promise<boolean>((resolve, reject) => {
      candidateServer.once("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
          resolve(false);
          return;
        }

        reject(error);
      });

      candidateServer.listen(occupiedPort, "127.0.0.1", () => resolve(true));
    });

    if (listened) {
      busyPortServer = candidateServer;
    } else {
      occupiedPort += 1;
    }
  }

  context.after(async () => {
    await rm(provisionerHome, { recursive: true, force: true });
  });

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      busyPortServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  const api = await createApiTestContext(context, {
    projects: [],
    instanceCreator: {
      homeDir: provisionerHome,
      managerRootDir: repoRoot,
    },
  });

  const response = await api.request
    .post("/api/projects")
    .send({
      createInstance: true,
      id: "fresh-agent",
      name: "Fresh Agent",
      gateway: {
        protocol: "http",
        host: "127.0.0.1",
      },
      auth: {
        mode: "inherit_manager",
      },
      templateId: "stateless",
      applyTemplateAfterCreate: true,
    })
    .expect(201);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.projectId, "fresh-agent");
  assert.ok(response.body.instance.port > occupiedPort);
  assert.equal(response.body.instance.rootPath, response.body.instance.stateDirPath);
  assert.equal(response.body.appliedTemplateId, "stateless");
  assert.equal(response.body.instance.authLinkMode, "copy");

  const authProfilesStat = await lstat(
    path.join(response.body.instance.stateDirPath, "agents", "main", "agent", "auth-profiles.json"),
  );
  const modelsStat = await lstat(
    path.join(response.body.instance.stateDirPath, "agents", "main", "agent", "models.json"),
  );
  assert.equal(authProfilesStat.isSymbolicLink(), false);
  assert.equal(modelsStat.isSymbolicLink(), true);

  const authProfiles = await readFile(
    path.join(response.body.instance.stateDirPath, "agents", "main", "agent", "auth-profiles.json"),
    "utf8",
  );
  const sharedAuthProfiles = await readFile(
    path.join(provisionerHome, ".openclaw", "agents", "main", "agent", "auth-profiles.json"),
    "utf8",
  );
  assert.equal(authProfiles, sharedAuthProfiles);

  const workspaceMemoryDirStat = await lstat(path.join(response.body.instance.workspacePath, "memory"));
  assert.equal(workspaceMemoryDirStat.isDirectory(), true);
  const memoryMarkdown = await readFile(path.join(response.body.instance.workspacePath, "MEMORY.md"), "utf8");
  assert.equal(memoryMarkdown, "");

  const config = JSON.parse(
    await readFile(response.body.instance.configPath, "utf8"),
  ) as Record<string, unknown>;
  const gateway = expectJsonObject(config.gateway);
  assert.equal(gateway.port, response.body.instance.port);
  assert.equal("commands" in config, false);

  const detail = await api.request.get("/api/projects/fresh-agent").expect(200);
  assert.equal(detail.body.item.memory.mode, "stateless");
  assert.equal(detail.body.item.sandbox.mode, "off");

  const history = await api.request
    .get("/api/actions?projectId=fresh-agent&limit=3")
    .expect(200);
  assert.deepEqual(
    history.body.items.map((item: { actionName: string }) => item.actionName),
    ["project_create", "template_apply"],
  );
});

test("createInstance serializes concurrent port allocation across provisioners", async (context) => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const provisionerHome = await createProvisionerHome();

  context.after(async () => {
    await rm(provisionerHome, { recursive: true, force: true });
  });

  const runtimeOptions = {
    homeDir: provisionerHome,
    managerRootDir: repoRoot,
  };

  const [first, second] = await Promise.all([
    createInstance(
      {
        profileName: "race-one",
        displayName: "Race One",
      },
      [],
      runtimeOptions,
    ),
    createInstance(
      {
        profileName: "race-two",
        displayName: "Race Two",
      },
      [],
      runtimeOptions,
    ),
  ]);

  assert.notEqual(first.port, second.port);
});

test("createInstance initializes auth-profiles.json when the shared auth store is missing", async (context) => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const provisionerHome = await createProvisionerHome({
    includeAuthProfiles: false,
  });

  context.after(async () => {
    await rm(provisionerHome, { recursive: true, force: true });
  });

  const instance = await createInstance(
    {
      profileName: "init-auth",
      displayName: "Init Auth",
    },
    [],
    {
      homeDir: provisionerHome,
      managerRootDir: repoRoot,
    },
  );

  assert.equal(instance.authLinkMode, "initialized");

  const authProfilesPath = path.join(
    instance.stateDirPath,
    "agents",
    "main",
    "agent",
    "auth-profiles.json",
  );
  const authProfilesStat = await lstat(authProfilesPath);
  assert.equal(authProfilesStat.isSymbolicLink(), false);
  assert.deepEqual(JSON.parse(await readFile(authProfilesPath, "utf8")), {
    version: 1,
    profiles: {},
  });
});

test("createInstance strips unsupported OpenClaw 2026.2.10 config keys from generated config", async (context) => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const provisionerHome = await createProvisionerHome();

  context.after(async () => {
    await rm(provisionerHome, { recursive: true, force: true });
  });

  const instance = await createInstance(
    {
      profileName: "telegram-bot",
      displayName: "Telegram Bot",
      channelType: "telegram",
      channelCredentials: {
        botToken: "telegram-test-token",
      },
    },
    [],
    {
      homeDir: provisionerHome,
      managerRootDir: repoRoot,
    },
  );

  const config = JSON.parse(await readFile(instance.configPath, "utf8")) as Record<string, unknown>;
  assert.equal("commands" in config, false);

  const channels = expectJsonObject(config.channels);
  const telegram = expectJsonObject(channels.telegram);
  assert.equal("streaming" in telegram, false);
});

test("provisioned instance create forces inherited auth and only persists validated managed lifecycle fields", async (context) => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const provisionerHome = await createProvisionerHome();

  context.after(async () => {
    await rm(provisionerHome, { recursive: true, force: true });
  });

  const api = await createApiTestContext(context, {
    projects: [],
    instanceCreator: {
      homeDir: provisionerHome,
      managerRootDir: repoRoot,
    },
  });

  await api.request
    .post("/api/projects")
    .send({
      createInstance: true,
      id: "validated-agent",
      name: "Validated Agent",
      gateway: {
        protocol: "http",
        host: "127.0.0.1",
      },
      auth: {
        mode: "custom",
        strategy: "password",
        label: "should not persist",
        secret: "ignored-secret",
      },
      lifecycle: {
        mode: "custom_commands",
        startCommand: "printf should-not-persist",
        nodePath: "  /usr/bin/node  ",
        cliPath: "  openclaw  ",
        bind: "lan",
        allowUnconfigured: false,
        startupTimeoutMs: 9000,
        injected: "ignored",
      },
    })
    .expect(201);

  const detail = await api.request.get("/api/projects/validated-agent").expect(200);

  assert.equal(detail.body.registry.auth.mode, "inherit_manager");
  assert.equal(detail.body.registry.lifecycle.mode, "managed_openclaw");
  assert.equal(detail.body.registry.lifecycle.nodePath, "/usr/bin/node");
  assert.equal(detail.body.registry.lifecycle.cliPath, "openclaw");
  assert.equal(detail.body.registry.lifecycle.bind, "lan");
  assert.equal(detail.body.registry.lifecycle.allowUnconfigured, false);
  assert.equal(detail.body.registry.lifecycle.startupTimeoutMs, 9000);
  assert.equal("startCommand" in detail.body.registry.lifecycle, false);
  assert.equal("injected" in detail.body.registry.lifecycle, false);
});

test("provisioned instance create rolls back provisioned files when registry validation fails", async (context) => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const provisionerHome = await createProvisionerHome();

  context.after(async () => {
    await rm(provisionerHome, { recursive: true, force: true });
  });

  const api = await createApiTestContext(context, {
    projects: [],
    instanceCreator: {
      homeDir: provisionerHome,
      managerRootDir: repoRoot,
    },
  });

  const response = await api.request
    .post("/api/projects")
    .send({
      createInstance: true,
      id: "cleanup-target",
      name: "Cleanup Target",
      gateway: {
        protocol: "http",
        host: "127.0.0.1",
      },
      capabilities: {
        bulkHooks: "yes",
      },
    })
    .expect(400);

  assert.match(response.body.error.message, /project\.capabilities\.bulkHooks/);
  assert.equal(await pathExists(path.join(provisionerHome, ".openclaw-cleanup-target")), false);
  assert.equal(
    await pathExists(path.join(provisionerHome, ".openclaw", "workspace-cleanup-target")),
    false,
  );

  const projects = await api.request.get("/api/projects").expect(200);
  assert.equal(projects.body.items.length, 0);
});

test("project list exposes hook config and skill catalog metadata", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const project = await createProjectFixture(api.tempDir, {
    id: "catalog-target",
    gatewayPort: 19936,
    config: {
      gateway: {
        port: 19936,
      },
      hooks: {
        internal: {
          enabled: true,
          entries: {
            "daily-summary": {
              enabled: true,
            },
          },
        },
      },
      skills: {
        entries: {
          github: {
            enabled: true,
          },
          "private-helper": {
            enabled: false,
          },
        },
      },
    },
  });

  await mkdir(path.join(project.paths.rootPath, "skills", "github"), {
    recursive: true,
  });
  await writeFile(path.join(project.paths.rootPath, "skills", "github", "SKILL.md"), "# github\n", "utf8");
  await mkdir(path.join(project.paths.workspacePath, "skills", "private-helper"), {
    recursive: true,
  });
  await writeFile(
    path.join(project.paths.workspacePath, "skills", "private-helper", "SKILL.md"),
    "# private-helper\n",
    "utf8",
  );

  await api.request.post("/api/projects").send(project).expect(201);

  const response = await api.request.get("/api/projects").expect(200);
  const item = response.body.items[0];

  assert.equal(item.hooks.enabledCount, 1);
  assert.deepEqual(item.hooks.entries.map((entry: { name: string }) => entry.name), ["daily-summary"]);
  assert.equal(item.skills.enabledCount, 1);
  assert.equal(item.skills.officialCount, 1);
  assert.equal(item.skills.configuredEntries.length, 2);
  assert.ok(item.skills.customCount >= 1);
  assert.deepEqual(
    item.skills.configuredEntries.map((entry: { name: string; official: boolean; enabled: boolean }) => [
      entry.name,
      entry.official,
      entry.enabled,
    ]),
    [
      ["github", true, true],
      ["private-helper", false, false],
    ],
  );
});

test("project action route executes lifecycle command and records stdout in history", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const project = await createProjectFixture(api.tempDir, {
    id: "action-target",
    gatewayPort: 19933,
    lifecycle: {
      startCommand: "printf action-started",
    },
  });

  await api.request.post("/api/projects").send(project).expect(201);

  const actionResponse = await api.request.post("/api/projects/action-target/actions/start").expect(200);

  assert.equal(actionResponse.body.ok, true);
  assert.equal(actionResponse.body.result.stdout, "action-started");

  const history = await api.request.get("/api/actions?projectId=action-target&limit=3").expect(200);

  assert.equal(history.body.items[0].actionName, "start");
  assert.match(history.body.items[0].command, /printf action-started/);
  assert.equal(history.body.items[0].stdout, "action-started");
});

test("managed OpenClaw lifecycle starts and stops a detached gateway process", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const fakeCliPath = await createFakeOpenClawCli(api.tempDir);
  const project = await createProjectFixture(api.tempDir, {
    id: "managed-target",
    gatewayPort: 19935,
    lifecycle: {
      mode: "managed_openclaw",
      nodePath: process.execPath,
      cliPath: fakeCliPath,
      bind: "loopback",
      allowUnconfigured: true,
      startupTimeoutMs: 4000,
    },
  });

  await api.request.post("/api/projects").send(project).expect(201);

  const startResponse = await api.request
    .post("/api/projects/managed-target/actions/start")
    .expect(200);

  assert.equal(startResponse.body.ok, true);
  assert.equal(startResponse.body.item.runtimeStatus, "running");
  assert.equal(startResponse.body.item.healthStatus, "healthy");
  assert.match(startResponse.body.result.command, /fake-openclaw\.mjs/);

  const listWhileRunning = await api.request.get("/api/projects").expect(200);
  assert.equal(listWhileRunning.body.items[0].runtimeStatus, "running");
  assert.equal(listWhileRunning.body.items[0].healthStatus, "healthy");

  const stopResponse = await api.request
    .post("/api/projects/managed-target/actions/stop")
    .expect(200);

  assert.equal(stopResponse.body.ok, true);
  assert.equal(stopResponse.body.item.runtimeStatus, "stopped");
  assert.equal(stopResponse.body.item.healthStatus, "unknown");

  const history = await api.request.get("/api/actions?projectId=managed-target&limit=5").expect(200);
  assert.deepEqual(
    history.body.items.slice(0, 2).map((item: { actionName: string }) => item.actionName),
    ["stop", "start"],
  );
});

test("managed OpenClaw start fails fast on invalid config JSON", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const fakeCliPath = await createFakeOpenClawCli(api.tempDir);
  const project = await createProjectFixture(api.tempDir, {
    id: "managed-broken-config-target",
    gatewayPort: 19946,
    lifecycle: {
      mode: "managed_openclaw",
      nodePath: process.execPath,
      cliPath: fakeCliPath,
      bind: "loopback",
      allowUnconfigured: true,
      startupTimeoutMs: 4000,
    },
  });

  await api.request.post("/api/projects").send(project).expect(201);
  await writeFile(project.paths.configPath, "{broken-json\n", "utf8");

  const startResponse = await api.request
    .post("/api/projects/managed-broken-config-target/actions/start")
    .expect(200);

  assert.equal(startResponse.body.ok, false);
  assert.equal(startResponse.body.item.runtimeStatus, "stopped");
  assert.equal(startResponse.body.item.healthStatus, "unhealthy");
  assert.match(startResponse.body.result.stderr, /invalid JSON/i);
});

test("project model route writes config, extends allowlist, and restarts running projects", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const server = http.createServer((request, response) => {
    if (request.url === "/healthz" || request.url === "/readyz") {
      response.writeHead(200, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/plain",
    });
    response.end("ok");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP port.");
  }

  const project = await createProjectFixture(api.tempDir, {
    id: "model-target",
    gatewayPort: address.port,
    config: {
      gateway: {
        port: address.port,
      },
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5",
            fallbacks: ["anthropic/claude-opus-4-5"],
          },
          models: {
            "openai/gpt-5": {
              alias: "GPT 5",
            },
          },
        },
      },
    },
    lifecycle: {
      restartCommand: "printf model-restarted",
    },
  });

  await api.request.post("/api/projects").send(project).expect(201);

  const response = await api.request
    .patch("/api/projects/model-target/model")
    .send({
      modelRef: "anthropic/claude-opus-4-6",
      restartIfRunning: true,
    })
    .expect(200);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.previousModelRef, "openai/gpt-5");
  assert.equal(response.body.restartTriggered, true);
  assert.equal(response.body.result.stdout, "model-restarted");
  assert.equal(response.body.model.primaryRef, "anthropic/claude-opus-4-6");
  assert.deepEqual(response.body.model.fallbackRefs, ["anthropic/claude-opus-4-5"]);

  const config = await api.readProjectConfig("model-target");
  const agents = expectJsonObject(config.agents);
  const defaults = expectJsonObject(agents.defaults);
  const model = expectJsonObject(defaults.model);
  const models = expectJsonObject(defaults.models);

  assert.equal(model.primary, "anthropic/claude-opus-4-6");
  assert.deepEqual(model.fallbacks, ["anthropic/claude-opus-4-5"]);
  assert.deepEqual(expectJsonObject(models["anthropic/claude-opus-4-6"]), {});

  const history = await api.request.get("/api/actions?projectId=model-target&limit=3").expect(200);
  assert.equal(history.body.items[0].actionName, "model_update");
  assert.match(history.body.items[0].summary, /anthropic\/claude-opus-4-6/);
  assert.equal(history.body.items[0].command, "printf model-restarted");
});

test("project memory mode route switches between stateless and normal and blocks manager memory writes", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const server = http.createServer((request, response) => {
    if (request.url === "/healthz" || request.url === "/readyz") {
      response.writeHead(200, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/plain",
    });
    response.end("ok");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP port.");
  }

  const project = await createProjectFixture(api.tempDir, {
    id: "memory-mode-target",
    gatewayPort: address.port,
    config: {
      gateway: {
        port: address.port,
      },
      plugins: {
        slots: {
          memory: "memory-lancedb",
        },
      },
      hooks: {
        internal: {
          entries: {
            "session-memory": {
              enabled: true,
            },
          },
        },
      },
      agents: {
        defaults: {
          memorySearch: {
            enabled: true,
          },
          compaction: {
            memoryFlush: {
              enabled: true,
            },
          },
        },
      },
    },
    lifecycle: {
      restartCommand: "printf memory-mode-restarted",
    },
  });

  await api.request.post("/api/projects").send(project).expect(201);

  const statelessResponse = await api.request
    .patch("/api/projects/memory-mode-target/memory-mode")
    .send({
      mode: "stateless",
      restartIfRunning: true,
    })
    .expect(200);

  assert.equal(statelessResponse.body.ok, true);
  assert.equal(statelessResponse.body.previousMode, "normal");
  assert.equal(statelessResponse.body.restartTriggered, true);
  assert.equal(statelessResponse.body.result.stdout, "memory-mode-restarted");
  assert.equal(statelessResponse.body.memory.mode, "stateless");
  assert.equal(statelessResponse.body.memory.canReadMemory, false);
  assert.equal(statelessResponse.body.memory.canWriteMemory, false);

  const statelessConfig = await api.readProjectConfig("memory-mode-target");
  const statelessPlugins = expectJsonObject(statelessConfig.plugins);
  const statelessSlots = expectJsonObject(statelessPlugins.slots);
  const statelessAgents = expectJsonObject(statelessConfig.agents);
  const statelessDefaults = expectJsonObject(statelessAgents.defaults);
  const statelessMemorySearch = expectJsonObject(statelessDefaults.memorySearch);
  const statelessCompaction = expectJsonObject(statelessDefaults.compaction);
  const statelessMemoryFlush = expectJsonObject(statelessCompaction.memoryFlush);
  const statelessHooks = expectJsonObject(statelessConfig.hooks);
  const statelessInternal = expectJsonObject(statelessHooks.internal);
  const statelessEntries = expectJsonObject(statelessInternal.entries);
  const statelessSessionMemory = expectJsonObject(statelessEntries["session-memory"]);
  const statelessMeta = expectJsonObject(statelessConfig.meta);
  const managerMeta = expectJsonObject(statelessMeta.openclawManager);
  const backup = expectJsonObject(managerMeta.memoryModeBackup);
  const backupPluginSlot = expectJsonObject(backup.pluginSlotMemory);

  assert.equal(statelessSlots.memory, "none");
  assert.equal(statelessMemorySearch.enabled, false);
  assert.equal(statelessMemoryFlush.enabled, false);
  assert.equal(statelessSessionMemory.enabled, false);
  assert.equal(managerMeta.memoryMode, "stateless");
  assert.equal(backupPluginSlot.value, "memory-lancedb");

  const blockedMemoryResponse = await api.request
    .post("/api/bulk/execute")
    .send({
      action: "memory",
      projectIds: ["memory-mode-target"],
      payload: {
        mode: "append",
        blockId: "should-not-write",
        content: "this write should be blocked",
      },
    })
    .expect(200);

  assert.equal(blockedMemoryResponse.body.ok, false);
  assert.match(blockedMemoryResponse.body.results[0].message, /memory mode is stateless/i);

  const normalResponse = await api.request
    .patch("/api/projects/memory-mode-target/memory-mode")
    .send({
      mode: "normal",
      restartIfRunning: false,
    })
    .expect(200);

  assert.equal(normalResponse.body.ok, true);
  assert.equal(normalResponse.body.previousMode, "stateless");
  assert.equal(normalResponse.body.restartTriggered, false);
  assert.equal(normalResponse.body.memory.mode, "normal");
  assert.equal(normalResponse.body.memory.effectivePluginSlot, "memory-lancedb");

  const normalConfig = await api.readProjectConfig("memory-mode-target");
  const normalPlugins = expectJsonObject(normalConfig.plugins);
  const normalSlots = expectJsonObject(normalPlugins.slots);
  const normalAgents = expectJsonObject(normalConfig.agents);
  const normalDefaults = expectJsonObject(normalAgents.defaults);
  const normalMemorySearch = expectJsonObject(normalDefaults.memorySearch);
  const normalCompaction = expectJsonObject(normalDefaults.compaction);
  const normalMemoryFlush = expectJsonObject(normalCompaction.memoryFlush);
  const normalHooks = expectJsonObject(normalConfig.hooks);
  const normalInternal = expectJsonObject(normalHooks.internal);
  const normalEntries = expectJsonObject(normalInternal.entries);
  const normalSessionMemory = expectJsonObject(normalEntries["session-memory"]);

  assert.equal(normalSlots.memory, "memory-lancedb");
  assert.equal(normalMemorySearch.enabled, true);
  assert.equal(normalMemoryFlush.enabled, true);
  assert.equal(normalSessionMemory.enabled, true);
  assert.equal("meta" in normalConfig, false);
});

test("project template route exposes catalog and applies sandboxed template to config", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const server = http.createServer((request, response) => {
    if (request.url === "/healthz" || request.url === "/readyz") {
      response.writeHead(200, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/plain",
    });
    response.end("ok");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP port.");
  }

  const project = await createProjectFixture(api.tempDir, {
    id: "template-target",
    gatewayPort: address.port,
    config: {
      gateway: {
        port: address.port,
      },
      plugins: {
        slots: {
          memory: "memory-core",
        },
      },
      agents: {
        defaults: {
          compaction: {
            memoryFlush: {
              enabled: true,
            },
          },
        },
      },
    },
    lifecycle: {
      restartCommand: "printf template-restarted",
    },
  });

  await api.request.post("/api/projects").send(project).expect(201);

  const templatesResponse = await api.request.get("/api/projects/templates").expect(200);
  const templateIds = templatesResponse.body.items.map((item: { id: string }) => item.id);
  assert.ok(templateIds.length >= 3);
  assert.ok(templateIds.includes("general"));
  assert.ok(templateIds.includes("stateless"));
  assert.ok(templateIds.includes("sandboxed"));

  const applyResponse = await api.request
    .post("/api/projects/template-target/apply-template")
    .send({
      templateId: "sandboxed",
      restartIfRunning: true,
    })
    .expect(200);

  assert.equal(applyResponse.body.ok, true);
  assert.equal(applyResponse.body.templateId, "sandboxed");
  assert.equal(applyResponse.body.restartTriggered, true);
  assert.equal(applyResponse.body.result.stdout, "template-restarted");
  assert.equal(applyResponse.body.memory.mode, "normal");
  assert.equal(applyResponse.body.sandbox.mode, "all");
  assert.equal(applyResponse.body.sandbox.backend, "docker");
  assert.equal(applyResponse.body.sandbox.scope, "session");
  assert.equal(applyResponse.body.sandbox.workspaceAccess, "none");
  assert.equal(applyResponse.body.sandbox.dockerNetwork, "none");

  const config = await api.readProjectConfig("template-target");
  const agents = expectJsonObject(config.agents);
  const defaults = expectJsonObject(agents.defaults);
  const sandbox = expectJsonObject(defaults.sandbox);
  const docker = expectJsonObject(sandbox.docker);

  assert.equal(sandbox.mode, "all");
  assert.equal("backend" in sandbox, false);
  assert.equal(sandbox.scope, "session");
  assert.equal(sandbox.workspaceAccess, "none");
  assert.equal(docker.network, "none");

  const history = await api.request.get("/api/actions?projectId=template-target&limit=5").expect(200);
  assert.equal(history.body.items[0].actionName, "template_apply");
  assert.match(history.body.items[0].summary, /sandboxed|沙箱隔离 Bot/);
});

test("bulk action route updates files and records bulk history", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const project = await createProjectFixture(api.tempDir, {
    id: "bulk-target",
    gatewayPort: 19934,
  });

  await api.request.post("/api/projects").send(project).expect(201);

  await api.request
    .post("/api/bulk/execute")
    .send({
      action: "hooks",
      projectIds: ["bulk-target"],
      payload: {
        mode: "enable",
        hookName: "daily-summary",
      },
    })
    .expect(200);

  await api.request
    .post("/api/bulk/execute")
    .send({
      action: "memory",
      projectIds: ["bulk-target"],
      payload: {
        mode: "append",
        blockId: "bulk-history-block",
        content: "remember this test line",
      },
    })
    .expect(200);

  const config = await api.readProjectConfig("bulk-target");
  const hooks = expectJsonObject(config.hooks);
  const internal = expectJsonObject(hooks.internal);
  const entries = expectJsonObject(internal.entries);
  const dailySummary = expectJsonObject(entries["daily-summary"]);

  assert.equal(internal.enabled, true);
  assert.equal(dailySummary.enabled, true);

  const memory = await api.readProjectMemory("bulk-target");
  assert.match(memory, /bulk-history-block/);
  assert.match(memory, /remember this test line/);

  const history = await api.request.get("/api/actions?projectId=bulk-target&limit=5").expect(200);
  assert.equal(history.body.items[0].kind, "bulk_action");
  assert.match(history.body.items[0].summary, /Memory append block bulk-history-block/);
  assert.equal(history.body.items[1].kind, "bulk_action");
  assert.match(history.body.items[1].summary, /Hook daily-summary -> enable/);
});

test("compatibility scan route classifies partial projects and persists the result", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const project = await createProjectFixture(api.tempDir, {
    id: "compat-target",
    gatewayPort: 19935,
    config: {
      gateway: {
        port: 19935,
      },
      hooks: {
        internal: {
          enabled: false,
          entries: {},
        },
      },
    },
  });

  await api.request.post("/api/projects").send(project).expect(201);

  const scanResponse = await api.request
    .post("/api/projects/compat-target/scan-compatibility")
    .expect(200);

  assert.equal(scanResponse.body.ok, true);
  assert.equal(scanResponse.body.compatibility.status, "runtime_only");
  assert.equal(
    scanResponse.body.compatibility.checks.find((check: { name: string }) => check.name === "skills")
      ?.supported,
    false,
  );

  const detailResponse = await api.request.get("/api/projects/compat-target").expect(200);

  assert.equal(detailResponse.body.registry.compatibility.status, "runtime_only");

  const history = await api.request.get("/api/actions?projectId=compat-target&limit=5").expect(200);

  assert.equal(history.body.items[0].actionName, "compatibility_scan");
});

test("GET /api/projects/:id ignores unrelated broken project configs", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const target = await createProjectFixture(api.tempDir, {
    id: "detail-isolated-target",
    gatewayPort: 19941,
  });
  const broken = await createProjectFixture(api.tempDir, {
    id: "detail-broken-neighbor",
    gatewayPort: 19942,
  });

  await api.request.post("/api/projects").send(target).expect(201);
  await api.request.post("/api/projects").send(broken).expect(201);
  await writeFile(broken.paths.configPath, "{broken-json\n", "utf8");

  const response = await api.request.get("/api/projects/detail-isolated-target").expect(200);

  assert.equal(response.body.item.id, "detail-isolated-target");
  assert.equal(response.body.registry.id, "detail-isolated-target");
});

test("project action route ignores unrelated broken project configs when building item", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const target = await createProjectFixture(api.tempDir, {
    id: "action-isolated-target",
    gatewayPort: 19943,
    lifecycle: {
      mode: "custom_commands",
      startCommand: "printf isolated-start",
      stopCommand: "printf isolated-stop",
      restartCommand: "printf isolated-restart",
    },
  });
  const broken = await createProjectFixture(api.tempDir, {
    id: "action-broken-neighbor",
    gatewayPort: 19944,
  });

  await api.request.post("/api/projects").send(target).expect(201);
  await api.request.post("/api/projects").send(broken).expect(201);
  await writeFile(broken.paths.configPath, "{broken-json\n", "utf8");

  const response = await api.request
    .post("/api/projects/action-isolated-target/actions/start")
    .expect(200);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.result.stdout, "isolated-start");
  assert.equal(response.body.item.id, "action-isolated-target");
  assert.equal(response.body.item.runtimeStatus, "stopped");
});

test("HTML fallback health endpoints are reported as running but degraded", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end("<!doctype html><title>fallback</title>");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP port.");
  }

  const project = await createProjectFixture(api.tempDir, {
    id: "html-fallback-target",
    gatewayPort: address.port,
  });

  await api.request.post("/api/projects").send(project).expect(201);

  const response = await api.request.get("/api/projects").expect(200);
  const item = response.body.items.find((entry: { id: string }) => entry.id === "html-fallback-target");

  assert.equal(item.runtimeStatus, "running");
  assert.equal(item.healthStatus, "degraded");

  const compatibility = await api.request
    .post("/api/projects/html-fallback-target/scan-compatibility")
    .expect(200);

  assert.equal(
    compatibility.body.compatibility.checks.find((check: { name: string }) => check.name === "gateway_probe")
      ?.supported,
    false,
  );
});

test("IP allowlist blocks non-allowlisted clients when trust proxy is enabled", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
    accessControl: {
      allowedIps: ["192.168.7.6"],
      trustProxy: true,
    },
  });

  await api.request
    .get("/api/projects")
    .set("X-Forwarded-For", "192.168.7.10")
    .expect(403);

  const allowedResponse = await api.request
    .get("/api/projects")
    .set("X-Forwarded-For", "192.168.7.6")
    .expect(200);

  assert.equal(allowedResponse.body.source, "registry");
});

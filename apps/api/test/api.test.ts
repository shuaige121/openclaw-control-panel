import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  createApiTestContext,
  createFakeOpenClawCli,
  createProjectFixture,
  expectJsonObject,
} from "./helpers";

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

test("project smoke test route runs fixed prompts and records history", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const fakeCliPath = await createFakeOpenClawCli(api.tempDir);
  const project = await createProjectFixture(api.tempDir, {
    id: "smoke-target",
    gatewayPort: 19938,
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
  await api.request.post("/api/projects/smoke-target/actions/start").expect(200);

  const response = await api.request.post("/api/projects/smoke-target/smoke-test").expect(200);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.summary.passed, 4);
  assert.equal(response.body.summary.total, 4);
  assert.equal(response.body.summary.provider, "anthropic");
  assert.equal(response.body.summary.model, "claude-opus-4-6");
  assert.deepEqual(
    response.body.results.map((entry: { id: string; ok: boolean }) => [entry.id, entry.ok]),
    [
      ["model_identity", true],
      ["tool_exec_time", true],
      ["tool_web_fetch", true],
      ["context_recall", true],
    ],
  );
  assert.match(response.body.results[1].toolHint, /exec/i);
  assert.match(response.body.results[2].toolHint, /web_fetch/i);

  const list = await api.request.get("/api/projects").expect(200);
  const item = list.body.items.find((entry: { id: string }) => entry.id === "smoke-target");

  assert.ok(item);
  assert.equal(item.lastSmokeTest.summary.passed, 4);
  assert.equal(item.lastSmokeTest.summary.model, "claude-opus-4-6");
  assert.equal(item.model.lastObservedProvider, "anthropic");
  assert.equal(item.model.lastObservedRef, "claude-opus-4-6");
  assert.equal(typeof item.model.lastObservedAt, "string");

  const history = await api.request.get("/api/actions?projectId=smoke-target&limit=5").expect(200);
  assert.equal(history.body.items[0].actionName, "smoke_test");
  assert.match(history.body.items[0].summary, /4\/4/);
  assert.match(history.body.items[0].stdout, /网页抓取工具/);
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
  assert.deepEqual(
    templatesResponse.body.items.map((item: { id: string }) => item.id),
    ["general", "stateless", "sandboxed", "ultramarines", "sisters-of-silence", "iron-hands", "blood-angels", "dark-angels"],
  );

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

test("bulk action route supports skill toggles and config path deletion", async (context) => {
  const api = await createApiTestContext(context, {
    projects: [],
  });
  const project = await createProjectFixture(api.tempDir, {
    id: "config-target",
    gatewayPort: 19937,
    config: {
      gateway: {
        port: 19937,
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
        },
      },
    },
  });

  await api.request.post("/api/projects").send(project).expect(201);

  await api.request
    .post("/api/bulk/execute")
    .send({
      action: "skills",
      projectIds: ["config-target"],
      payload: {
        mode: "disable",
        skillName: "github",
      },
    })
    .expect(200);

  await api.request
    .post("/api/bulk/execute")
    .send({
      action: "config",
      projectIds: ["config-target"],
      payload: {
        mode: "delete",
        path: "hooks.internal.entries.daily-summary",
      },
    })
    .expect(200);

  await api.request
    .post("/api/bulk/execute")
    .send({
      action: "config",
      projectIds: ["config-target"],
      payload: {
        mode: "delete",
        path: "skills.entries.github",
      },
    })
    .expect(200);

  const config = await api.readProjectConfig("config-target");
  const hooks = expectJsonObject(config.hooks);
  const internal = expectJsonObject(hooks.internal);
  const entries = expectJsonObject(internal.entries);
  const skills = expectJsonObject(config.skills);
  const skillEntries = expectJsonObject(skills.entries);

  assert.equal("daily-summary" in entries, false);
  assert.equal("github" in skillEntries, false);

  const history = await api.request.get("/api/actions?projectId=config-target&limit=5").expect(200);
  assert.equal(history.body.items[0].actionName, "bulk_config");
  assert.equal(history.body.items[1].actionName, "bulk_config");
  assert.equal(history.body.items[2].actionName, "bulk_skills");
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

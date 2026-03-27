import fs from "node:fs/promises";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import { HttpError } from "../lib/http-error";
import { ActionHistoryService } from "../services/action-history";
import {
  createInstance,
  type CreateInstanceResult,
  type CreateInstanceRuntimeOptions,
} from "../services/instance-creator";
import { executeProjectAction } from "../services/project-command-runner";
import { readProjectMemoryProfile, updateProjectMemoryMode } from "../services/project-memory-mode";
import { readProjectModelProfile, updateProjectPrimaryModel } from "../services/project-models";
import { runProjectSmokeTest } from "../services/project-smoke-test";
import { applyProjectTemplate, listProjectTemplates } from "../services/project-templates";
import { scanProjectCompatibility } from "../services/project-compatibility";
import { buildManagerAuthProfile, buildProjectListItem, buildProjectListResponse, probeProjectRuntime } from "../services/project-probe";
import { type ProjectRegistryService } from "../services/project-registry";
import type {
  ProjectGatewayBindMode,
  ProjectManagedOpenClawLifecycle,
  ProjectMemoryMode,
  ProjectTemplateId,
} from "../types/project";

type AsyncRouteHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<void>;

const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function handleAsync(handler: AsyncRouteHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProjectIdForProvisioning(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "project.id must be a non-empty string.");
  }

  const normalizedId = value.trim().toLowerCase();
  if (!PROJECT_ID_PATTERN.test(normalizedId)) {
    throw new HttpError(
      400,
      "project.id must use lowercase letters, numbers, and single hyphens.",
    );
  }

  return normalizedId;
}

function parseRequestedGatewayPort(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isObject(value)) {
    throw new HttpError(400, "project.gateway must be an object.");
  }

  if (value.port === undefined) {
    return undefined;
  }

  if (
    typeof value.port !== "number" ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535
  ) {
    throw new HttpError(400, "project.gateway.port must be an integer between 1 and 65535.");
  }

  return value.port;
}

function parseOptionalChannelType(value: unknown):
  | "telegram"
  | "wecom"
  | "feishu"
  | "whatsapp"
  | "none"
  | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "telegram" ||
    value === "wecom" ||
    value === "feishu" ||
    value === "whatsapp" ||
    value === "none"
  ) {
    return value;
  }

  throw new HttpError(
    400,
    'channelType must be "none", "telegram", "wecom", "feishu", or "whatsapp".',
  );
}

function parseOptionalChannelCredentials(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isObject(value)) {
    throw new HttpError(400, "channelCredentials must be an object.");
  }

  const entries = Object.entries(value).map(([key, entryValue]) => {
    if (typeof entryValue !== "string") {
      throw new HttpError(400, `channelCredentials.${key} must be a string.`);
    }

    return [key, entryValue] as const;
  });

  return Object.fromEntries(entries);
}

function parseOptionalSandboxMode(value: unknown): "off" | "all" | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "off" || value === "all") {
    return value;
  }

  throw new HttpError(400, 'sandboxMode must be "off" or "all".');
}

function parseOptionalGatewayBindMode(value: unknown): ProjectGatewayBindMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "loopback" || value === "lan") {
    return value;
  }

  throw new HttpError(400, 'project.lifecycle.bind must be "loopback" or "lan".');
}

function parseOptionalTags(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, "project.tags must be an array of strings.");
  }

  return value.map((tag, index) => {
    if (typeof tag !== "string") {
      throw new HttpError(400, `project.tags[${index}] must be a string.`);
    }

    return tag;
  });
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalNullableString(
  value: unknown,
  fieldName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string or null.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new HttpError(400, `${fieldName} must be a boolean.`);
  }

  return value;
}

function parseOptionalPositiveInteger(
  value: unknown,
  fieldName: string,
  minimum: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new HttpError(
      400,
      `${fieldName} must be an integer greater than or equal to ${minimum}.`,
    );
  }

  return value;
}

function parseProvisionedLifecycle(value: unknown): ProjectManagedOpenClawLifecycle {
  if (value !== undefined && !isObject(value)) {
    throw new HttpError(400, "project.lifecycle must be an object.");
  }

  const lifecycle = isObject(value) ? value : {};

  return {
    mode: "managed_openclaw",
    nodePath: parseOptionalNullableString(
      lifecycle.nodePath,
      "project.lifecycle.nodePath",
    ) ?? null,
    cliPath: parseOptionalNullableString(
      lifecycle.cliPath,
      "project.lifecycle.cliPath",
    ) ?? null,
    bind: parseOptionalGatewayBindMode(lifecycle.bind) ?? "loopback",
    allowUnconfigured:
      parseOptionalBoolean(lifecycle.allowUnconfigured, "project.lifecycle.allowUnconfigured") ??
      true,
    startupTimeoutMs:
      parseOptionalPositiveInteger(
        lifecycle.startupTimeoutMs,
        "project.lifecycle.startupTimeoutMs",
        1000,
      ) ?? 15_000,
  };
}

async function cleanupProvisionedInstance(
  projectId: string,
  instance: CreateInstanceResult,
): Promise<void> {
  const pathsToRemove = Array.from(new Set([instance.workspacePath, instance.stateDirPath])).sort(
    (left, right) => right.length - left.length,
  );

  console.error("[projects] registry create failed after provisioning; cleaning up instance", {
    projectId,
    paths: pathsToRemove,
  });

  const results = await Promise.allSettled(
    pathsToRemove.map(async (targetPath) => {
      await fs.rm(targetPath, {
        recursive: true,
        force: true,
      });
    }),
  );

  const failedPaths = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            path: pathsToRemove[index],
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
        ]
      : [],
  );

  if (failedPaths.length > 0) {
    console.error("[projects] instance cleanup completed with errors", {
      projectId,
      failedPaths,
    });
    return;
  }

  console.info("[projects] cleaned up provisioned instance after registry failure", {
    projectId,
    paths: pathsToRemove,
  });
}

function parseOptionalTemplateId(value: unknown): ProjectTemplateId | undefined {
  if (value === undefined) {
    return undefined;
  }

  const validTemplateIds: ProjectTemplateId[] = [
    "general",
    "stateless",
    "sandboxed",
    "ultramarines",
    "sisters-of-silence",
    "iron-hands",
    "blood-angels",
    "dark-angels",
  ];

  if (typeof value !== "string" || !validTemplateIds.includes(value as ProjectTemplateId)) {
    throw new HttpError(
      400,
      `templateId must be one of: ${validTemplateIds.map((id) => `"${id}"`).join(", ")}.`,
    );
  }

  return value as ProjectTemplateId;
}

function parseApplyTemplateAfterCreate(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }

  return Boolean(value);
}

function resolveProvisionedName(projectId: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return projectId;
  }

  return value.trim();
}

function resolveProvisionedGateway(value: unknown, port: number): {
  protocol: "http" | "https";
  host: string;
  port: number;
} {
  if (!isObject(value)) {
    return {
      protocol: "http",
      host: "127.0.0.1",
      port,
    };
  }

  return {
    protocol: value.protocol === "https" ? "https" : "http",
    host:
      typeof value.host === "string" && value.host.trim().length > 0
        ? value.host.trim()
        : "127.0.0.1",
    port,
  };
}

function parseModelUpdateBody(value: unknown): {
  modelRef: string;
  restartIfRunning: boolean;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "model update body must be an object.");
  }

  const payload = value as Record<string, unknown>;
  const modelRef = payload.modelRef;
  if (typeof modelRef !== "string" || modelRef.trim().length === 0) {
    throw new HttpError(400, "modelRef must be a non-empty string.");
  }

  const restartIfRunning =
    payload.restartIfRunning === undefined ? true : Boolean(payload.restartIfRunning);

  return {
    modelRef: modelRef.trim(),
    restartIfRunning,
  };
}

function parseMemoryModeUpdateBody(value: unknown): {
  mode: ProjectMemoryMode;
  restartIfRunning: boolean;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "memory mode update body must be an object.");
  }

  const payload = value as Record<string, unknown>;
  const mode = payload.mode;
  if (mode !== "normal" && mode !== "locked" && mode !== "stateless") {
    throw new HttpError(400, 'mode must be "normal", "locked", or "stateless".');
  }

  const restartIfRunning =
    payload.restartIfRunning === undefined ? true : Boolean(payload.restartIfRunning);

  return {
    mode,
    restartIfRunning,
  };
}

function parseTemplateApplyBody(value: unknown): {
  templateId: ProjectTemplateId;
  restartIfRunning: boolean;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "template apply body must be an object.");
  }

  const VALID_TEMPLATE_IDS: ProjectTemplateId[] = [
    "general",
    "stateless",
    "sandboxed",
    "ultramarines",
    "sisters-of-silence",
    "iron-hands",
    "blood-angels",
    "dark-angels",
  ];

  const payload = value as Record<string, unknown>;
  const templateId = payload.templateId;
  if (typeof templateId !== "string" || !VALID_TEMPLATE_IDS.includes(templateId as ProjectTemplateId)) {
    throw new HttpError(
      400,
      `templateId must be one of: ${VALID_TEMPLATE_IDS.map((id) => `"${id}"`).join(", ")}.`,
    );
  }

  const restartIfRunning =
    payload.restartIfRunning === undefined ? true : Boolean(payload.restartIfRunning);

  return {
    templateId: templateId as ProjectTemplateId,
    restartIfRunning,
  };
}

export function createProjectsRouter(options: {
  registryService: ProjectRegistryService;
  actionHistoryService?: ActionHistoryService;
  instanceCreatorOptions?: CreateInstanceRuntimeOptions;
}) {
  const projectsRouter = Router();
  const registryService = options.registryService;
  const actionHistoryService = options.actionHistoryService ?? new ActionHistoryService();
  const instanceCreatorOptions = options.instanceCreatorOptions;
  const runtimeDir = path.join(path.dirname(registryService.getRegistryPath()), "runtime");

  projectsRouter.get(
    "/",
    handleAsync(async (_request, response) => {
      const registry = await registryService.readRegistry();
      response.json(await buildProjectListResponse(registry));
    }),
  );

  projectsRouter.patch(
    "/manager-auth",
    handleAsync(async (request, response) => {
      const managerAuth = await registryService.updateManagerAuth(request.body);
      response.json({
        ok: true,
        managerAuth: {
          strategy: managerAuth.strategy,
          label: managerAuth.label,
        },
        registryPath: registryService.getRegistryPath(),
      });
    }),
  );

  projectsRouter.post(
    "/",
    handleAsync(async (request, response) => {
      if (isObject(request.body) && request.body.createInstance === true) {
        const body = request.body;
        const projectId = parseProjectIdForProvisioning(body.id);
        const registry = await registryService.readRegistry();
        const projectName = resolveProvisionedName(projectId, body.name);
        const description = parseOptionalString(body.description, "project.description");
        const tags = parseOptionalTags(body.tags) ?? [];
        const templateId = parseOptionalTemplateId(body.templateId);
        const applyTemplateAfterCreate =
          templateId !== undefined && parseApplyTemplateAfterCreate(body.applyTemplateAfterCreate);
        const lifecycle = parseProvisionedLifecycle(body.lifecycle);

        if (registry.projects.some((project) => project.id === projectId)) {
          throw new HttpError(409, `Project "${projectId}" already exists.`);
        }

        const existingPorts = registry.projects.map((project) => project.gateway.port);

        let instance;
        try {
          instance = await createInstance(
            {
              profileName: projectId,
              displayName: projectName,
              description,
              model: parseOptionalString(body.model, "model"),
              port: parseRequestedGatewayPort(body.gateway),
              channelType: parseOptionalChannelType(body.channelType),
              channelCredentials: parseOptionalChannelCredentials(body.channelCredentials),
              sandboxMode: parseOptionalSandboxMode(body.sandboxMode),
              tags,
            },
            existingPorts,
            instanceCreatorOptions,
          );
        } catch (error) {
          if (error instanceof HttpError) {
            throw error;
          }

          throw new HttpError(
            500,
            error instanceof Error ? error.message : "Failed to create OpenClaw instance.",
          );
        }

        let createdProject;
        try {
          createdProject = await registryService.createProject({
            id: projectId,
            name: projectName,
            description: description ?? "",
            gateway: resolveProvisionedGateway(body.gateway, instance.port),
            tags,
            paths: {
              rootPath: instance.rootPath,
              configPath: instance.configPath,
              workspacePath: instance.workspacePath,
            },
            auth: {
              mode: "inherit_manager",
            },
            lifecycle,
            capabilities: isObject(body.capabilities)
              ? body.capabilities
              : {
                  bulkHooks: true,
                  bulkSkills: true,
                  bulkMemory: true,
                  bulkConfigPatch: true,
                },
          });
        } catch (error) {
          await cleanupProvisionedInstance(projectId, instance);
          throw error;
        }

        const compatibility = await scanProjectCompatibility(createdProject);
        let project = await registryService.updateProjectCompatibility(createdProject.id, compatibility);

        if (applyTemplateAfterCreate && templateId) {
          const applied = await applyProjectTemplate(project, templateId);
          await actionHistoryService.appendEntry({
            kind: "project_registry",
            ok: true,
            projects: [
              {
                id: project.id,
                name: project.name,
              },
            ],
            summary: `${project.name} 已套用模板 ${applied.template.name}`,
            detail: `Applied template ${applied.template.id} during provisioning. Memory mode is now ${applied.memory.mode}; sandbox mode is now ${applied.sandbox.mode}.`,
            command: null,
            stdout: null,
            stderr: null,
            durationMs: null,
            actionName: "template_apply",
          });
          project = await registryService.getProject(project.id);
        }

        await actionHistoryService.appendEntry({
          kind: "project_registry",
          ok: true,
          projects: [
            {
              id: project.id,
              name: project.name,
            },
          ],
          summary: `项目 ${project.name} 已创建`,
          detail: `Registered ${project.id} at gateway port ${project.gateway.port}.`,
          command: null,
          stdout: null,
          stderr: null,
          durationMs: null,
          actionName: "project_create",
        });
        response.status(201).json({
          ok: true,
          created: true,
          projectId: project.id,
          registryPath: registryService.getRegistryPath(),
          instance: {
            profileName: instance.profileName,
            port: instance.port,
            rootPath: instance.rootPath,
            configPath: instance.configPath,
            workspacePath: instance.workspacePath,
            stateDirPath: instance.stateDirPath,
            authLinkMode: instance.authLinkMode,
            modelsLinkMode: instance.modelsLinkMode,
            extensionsLinkMode: instance.extensionsLinkMode,
          },
          appliedTemplateId: applyTemplateAfterCreate ? templateId ?? null : null,
        });
        return;
      }

      const createdProject = await registryService.createProject(request.body);
      const compatibility = await scanProjectCompatibility(createdProject);
      const project = await registryService.updateProjectCompatibility(createdProject.id, compatibility);
      await actionHistoryService.appendEntry({
        kind: "project_registry",
        ok: true,
        projects: [
          {
            id: project.id,
            name: project.name,
          },
        ],
        summary: `项目 ${project.name} 已创建`,
        detail: `Registered ${project.id} at gateway port ${project.gateway.port}.`,
        command: null,
        stdout: null,
        stderr: null,
        durationMs: null,
        actionName: "project_create",
      });
      response.status(201).json({
        ok: true,
        projectId: project.id,
        registryPath: registryService.getRegistryPath(),
      });
    }),
  );

  projectsRouter.get(
    "/templates",
    handleAsync(async (_request, response) => {
      response.json({
        items: listProjectTemplates(),
        generatedAt: new Date().toISOString(),
      });
    }),
  );

  projectsRouter.get(
    "/:id",
    handleAsync(async (request, response) => {
      const registry = await registryService.readRegistry();
      const projectRecord = registry.projects.find((project) => project.id === request.params.id);

      if (!projectRecord) {
        throw new HttpError(404, `Project "${request.params.id}" was not found.`);
      }

      const item = await buildProjectListItem(projectRecord, registry);

      response.json({
        item,
        registry: {
          id: projectRecord.id,
          name: projectRecord.name,
          description: projectRecord.description,
          gateway: projectRecord.gateway,
          tags: projectRecord.tags,
          paths: projectRecord.paths,
          lifecycle: projectRecord.lifecycle,
          capabilities: projectRecord.capabilities,
          auth: item.auth,
          model: item.model,
          memory: item.memory,
          sandbox: item.sandbox,
          hooks: item.hooks,
          skills: item.skills,
          compatibility: projectRecord.compatibility,
        },
        managerAuth: buildManagerAuthProfile(registry),
      });
    }),
  );

  projectsRouter.patch(
    "/:id/model",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      const { modelRef, restartIfRunning } = parseModelUpdateBody(request.body);
      const update = await updateProjectPrimaryModel(project, modelRef);
      const runtime = await probeProjectRuntime(project);
      const restartResult =
        restartIfRunning && runtime.runtimeStatus === "running"
          ? await executeProjectAction(project, "restart", {
              runtimeDir,
            })
          : null;
      const ok = restartResult?.ok ?? true;
      const model = await readProjectModelProfile(project);

      await actionHistoryService.appendEntry({
        kind: "project_registry",
        ok,
        projects: [
          {
            id: project.id,
            name: project.name,
          },
        ],
        summary: `${project.name} 默认模型已切到 ${model.primaryRef ?? modelRef}`,
        detail: [
          `Default model: ${update.previousModelRef ?? "unset"} -> ${model.primaryRef ?? modelRef}.`,
          restartResult
            ? `Restart ${restartResult.ok ? "completed" : "failed"} in ${restartResult.durationMs}ms.`
            : "Project was not running, so no restart was triggered.",
        ].join(" "),
        command: restartResult?.command ?? null,
        stdout: restartResult?.stdout ?? null,
        stderr: restartResult?.stderr ?? null,
        durationMs: restartResult?.durationMs ?? null,
        actionName: "model_update",
      });

      const registry = await registryService.readRegistry();
      const projectRecord = registry.projects.find((entry) => entry.id === project.id) ?? project;
      const item = await buildProjectListItem(projectRecord, registry);

      response.json({
        ok,
        projectId: project.id,
        previousModelRef: update.previousModelRef,
        restartTriggered: restartResult !== null,
        result: restartResult,
        model,
        item,
      });
    }),
  );

  projectsRouter.patch(
    "/:id/memory-mode",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      const { mode, restartIfRunning } = parseMemoryModeUpdateBody(request.body);
      const update = await updateProjectMemoryMode(project, mode);
      const runtime = await probeProjectRuntime(project);
      const restartResult =
        restartIfRunning && runtime.runtimeStatus === "running"
          ? await executeProjectAction(project, "restart", {
              runtimeDir,
            })
          : null;
      const ok = restartResult?.ok ?? true;
      const memory = await readProjectMemoryProfile(project);

      await actionHistoryService.appendEntry({
        kind: "project_registry",
        ok,
        projects: [
          {
            id: project.id,
            name: project.name,
          },
        ],
        summary: `${project.name} 记忆模式已切到 ${memory.mode}`,
        detail: [
          `Memory mode: ${update.previousMode} -> ${memory.mode}.`,
          restartResult
            ? `Restart ${restartResult.ok ? "completed" : "failed"} in ${restartResult.durationMs}ms.`
            : "Project was not running, so no restart was triggered.",
        ].join(" "),
        command: restartResult?.command ?? null,
        stdout: restartResult?.stdout ?? null,
        stderr: restartResult?.stderr ?? null,
        durationMs: restartResult?.durationMs ?? null,
        actionName: "memory_mode_update",
      });

      const registry = await registryService.readRegistry();
      const projectRecord = registry.projects.find((entry) => entry.id === project.id) ?? project;
      const item = await buildProjectListItem(projectRecord, registry);

      response.json({
        ok,
        projectId: project.id,
        previousMode: update.previousMode,
        restartTriggered: restartResult !== null,
        result: restartResult,
        memory,
        item,
      });
    }),
  );

  projectsRouter.post(
    "/:id/apply-template",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      const { templateId, restartIfRunning } = parseTemplateApplyBody(request.body);
      const applied = await applyProjectTemplate(project, templateId);
      const runtime = await probeProjectRuntime(project);
      const restartResult =
        restartIfRunning && runtime.runtimeStatus === "running"
          ? await executeProjectAction(project, "restart", {
              runtimeDir,
            })
          : null;
      const ok = restartResult?.ok ?? true;

      await actionHistoryService.appendEntry({
        kind: "project_registry",
        ok,
        projects: [
          {
            id: project.id,
            name: project.name,
          },
        ],
        summary: `${project.name} 已套用模板 ${applied.template.name}`,
        detail: [
          `Applied template ${applied.template.id}.`,
          `Memory mode is now ${applied.memory.mode}; sandbox mode is now ${applied.sandbox.mode}.`,
          restartResult
            ? `Restart ${restartResult.ok ? "completed" : "failed"} in ${restartResult.durationMs}ms.`
            : "Project was not running, so no restart was triggered.",
        ].join(" "),
        command: restartResult?.command ?? null,
        stdout: restartResult?.stdout ?? null,
        stderr: restartResult?.stderr ?? null,
        durationMs: restartResult?.durationMs ?? null,
        actionName: "template_apply",
      });

      const registry = await registryService.readRegistry();
      const projectRecord = registry.projects.find((entry) => entry.id === project.id) ?? project;
      const item = await buildProjectListItem(projectRecord, registry);

      response.json({
        ok,
        projectId: project.id,
        templateId,
        restartTriggered: restartResult !== null,
        result: restartResult,
        memory: applied.memory,
        sandbox: applied.sandbox,
        item,
      });
    }),
  );

  projectsRouter.patch(
    "/:id",
    handleAsync(async (request, response) => {
      const updatedProject = await registryService.updateProject(request.params.id, request.body);
      const compatibility = await scanProjectCompatibility(updatedProject);
      const project = await registryService.updateProjectCompatibility(updatedProject.id, compatibility);
      await actionHistoryService.appendEntry({
        kind: "project_registry",
        ok: true,
        projects: [
          {
            id: project.id,
            name: project.name,
          },
        ],
        summary: `项目 ${project.name} 已更新`,
        detail: `Updated registry record for ${project.id}.`,
        command: null,
        stdout: null,
        stderr: null,
        durationMs: null,
        actionName: "project_update",
      });
      response.json({
        ok: true,
        projectId: project.id,
        registryPath: registryService.getRegistryPath(),
      });
    }),
  );

  projectsRouter.post(
    "/:id/smoke-test",
    handleAsync(async (request, response) => {
      const registry = await registryService.readRegistry();
      const project = registry.projects.find((entry) => entry.id === request.params.id);

      if (!project) {
        throw new HttpError(404, `Project "${request.params.id}" was not found.`);
      }

      const runtime = await probeProjectRuntime(project);
      if (runtime.runtimeStatus !== "running") {
        throw new HttpError(409, `Project "${project.id}" must be running before smoke testing.`);
      }

      const gatewayAuth =
        project.auth.mode === "inherit_manager"
          ? registry.managerAuth
          : {
              strategy: project.auth.strategy,
              secret: project.auth.secret,
            };

      const smoke = await runProjectSmokeTest({
        project,
        gatewayAuth,
      });
      await registryService.updateProjectSmokeTest(project.id, smoke.response);

      const summary = `${project.name} smoke test ${smoke.response.summary.passed}/${smoke.response.summary.total} 通过`;
      const detail = [
        `Provider: ${smoke.response.summary.provider ?? "unknown"}.`,
        `Model: ${smoke.response.summary.model ?? "unknown"}.`,
        ...smoke.response.results.map(
          (entry) =>
            `${entry.label}: ${entry.ok ? "ok" : `failed (${entry.error ?? "unknown error"})`} in ${entry.durationMs}ms.`,
        ),
      ].join(" ");

      await actionHistoryService.appendEntry({
        kind: "project_action",
        ok: smoke.response.ok,
        projects: [
          {
            id: project.id,
            name: project.name,
          },
        ],
        summary,
        detail,
        command: smoke.commandLog,
        stdout: smoke.stdoutLog,
        stderr: smoke.stderrLog.length > 0 ? smoke.stderrLog : null,
        durationMs: smoke.response.results.reduce((total, entry) => total + entry.durationMs, 0),
        actionName: "smoke_test",
      });

      response.json(smoke.response);
    }),
  );

  projectsRouter.post(
    "/:id/scan-compatibility",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      const compatibility = await scanProjectCompatibility(project);
      const updatedProject = await registryService.updateProjectCompatibility(project.id, compatibility);

      await actionHistoryService.appendEntry({
        kind: "project_registry",
        ok: true,
        projects: [
          {
            id: updatedProject.id,
            name: updatedProject.name,
          },
        ],
        summary: `项目 ${updatedProject.name} 已完成兼容性扫描`,
        detail: `Compatibility scan classified ${updatedProject.id} as ${updatedProject.compatibility.status}.`,
        command: null,
        stdout: null,
        stderr: null,
        durationMs: null,
        actionName: "compatibility_scan",
      });

      response.json({
        ok: true,
        projectId: updatedProject.id,
        compatibility: updatedProject.compatibility,
      });
    }),
  );

  projectsRouter.delete(
    "/:id",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      await registryService.deleteProject(request.params.id);
      await actionHistoryService.appendEntry({
        kind: "project_registry",
        ok: true,
        projects: [
          {
            id: project.id,
            name: project.name,
          },
        ],
        summary: `项目 ${project.name} 已删除`,
        detail: `Removed ${project.id} from the Control Panel registry.`,
        command: null,
        stdout: null,
        stderr: null,
        durationMs: null,
        actionName: "project_delete",
      });
      response.status(204).end();
    }),
  );

  return projectsRouter;
}

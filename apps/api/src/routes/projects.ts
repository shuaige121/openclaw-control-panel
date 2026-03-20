import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import { HttpError } from "../lib/http-error";
import { ActionHistoryService } from "../services/action-history";
import { executeProjectAction } from "../services/project-command-runner";
import { readProjectMemoryProfile, updateProjectMemoryMode } from "../services/project-memory-mode";
import { readProjectModelProfile, updateProjectPrimaryModel } from "../services/project-models";
import { runProjectSmokeTest } from "../services/project-smoke-test";
import { applyProjectTemplate, listProjectTemplates } from "../services/project-templates";
import { scanProjectCompatibility } from "../services/project-compatibility";
import { buildProjectListResponse, probeProjectRuntime } from "../services/project-probe";
import { type ProjectRegistryService } from "../services/project-registry";
import type { ProjectMemoryMode, ProjectTemplateId } from "../types/project";

type AsyncRouteHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<void>;

function handleAsync(handler: AsyncRouteHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
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
}) {
  const projectsRouter = Router();
  const registryService = options.registryService;
  const actionHistoryService = options.actionHistoryService ?? new ActionHistoryService();
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
      const list = await buildProjectListResponse(registry);
      const item = list.items.find((project) => project.id === request.params.id);
      const projectRecord = registry.projects.find((project) => project.id === request.params.id);

      if (!item || !projectRecord) {
        throw new HttpError(404, `Project "${request.params.id}" was not found.`);
      }

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
        managerAuth: list.managerAuth,
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
      const list = await buildProjectListResponse(registry);
      const item = list.items.find((entry) => entry.id === project.id) ?? null;

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
      const list = await buildProjectListResponse(registry);
      const item = list.items.find((entry) => entry.id === project.id) ?? null;

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
      const list = await buildProjectListResponse(registry);
      const item = list.items.find((entry) => entry.id === project.id) ?? null;

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

import { Router, type NextFunction, type Request, type Response } from "express";
import { HttpError } from "../lib/http-error";
import {
  attachFileToWorkspace,
  detachFileFromWorkspace,
  listWorkspaceFiles,
} from "../services/project-files";
import { ActionHistoryService } from "../services/action-history";
import { type ProjectRegistryService } from "../services/project-registry";

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

export function createFilesRouter(options: {
  registryService: ProjectRegistryService;
  actionHistoryService?: ActionHistoryService;
}) {
  const filesRouter = Router();
  const registryService = options.registryService;
  const actionHistoryService = options.actionHistoryService ?? new ActionHistoryService();

  filesRouter.get(
    "/:id/files",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      const result = await listWorkspaceFiles(project.paths.workspacePath);
      response.json(result);
    }),
  );

  filesRouter.post(
    "/:id/files",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      const body = request.body;

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new HttpError(400, "Request body must be a JSON object.");
      }

      const sourcePath = body.sourcePath;
      if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) {
        throw new HttpError(400, '"sourcePath" is required and must be a non-empty string.');
      }

      const name = typeof body.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : undefined;

      const mode = body.mode === "copy" ? "copy" as const : "symlink" as const;

      const description = typeof body.description === "string"
        ? body.description.trim()
        : undefined;

      const ensureTools = body.ensureTools !== false;

      const result = await attachFileToWorkspace({
        workspacePath: project.paths.workspacePath,
        configPath: project.paths.configPath,
        sourcePath: sourcePath.trim(),
        name,
        mode,
        description,
        ensureTools,
      });

      await actionHistoryService.appendEntry({
        kind: "project_action",
        ok: true,
        projects: [{ id: project.id, name: project.name }],
        summary: `${project.name} 附加文件 ${result.name}`,
        detail: `Attached ${result.sourcePath} as ${result.name} (${result.mode}, ${result.fileCount} files)`,
        command: null,
        stdout: null,
        stderr: null,
        durationMs: null,
        actionName: "attach_files",
      });

      response.status(201).json({
        ok: true,
        projectId: project.id,
        attached: {
          name: result.name,
          workspacePath: result.workspacePath,
          sourcePath: result.sourcePath,
          mode: result.mode,
          fileCount: result.fileCount,
        },
        toolsUpdated: result.toolsUpdated,
        warnings: result.warnings,
        restartRequired: result.toolsUpdated,
      });
    }),
  );

  filesRouter.delete(
    "/:id/files/:name",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      const name = request.params.name;

      await detachFileFromWorkspace({
        workspacePath: project.paths.workspacePath,
        name,
      });

      await actionHistoryService.appendEntry({
        kind: "project_action",
        ok: true,
        projects: [{ id: project.id, name: project.name }],
        summary: `${project.name} 移除文件 ${name}`,
        detail: `Detached ${name} from workspace`,
        command: null,
        stdout: null,
        stderr: null,
        durationMs: null,
        actionName: "detach_files",
      });

      response.json({ ok: true, projectId: project.id, detached: name });
    }),
  );

  return filesRouter;
}

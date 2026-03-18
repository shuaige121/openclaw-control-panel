import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import { HttpError } from "../lib/http-error";
import { ActionHistoryService } from "../services/action-history";
import { buildProjectListResponse } from "../services/project-probe";
import { executeProjectAction } from "../services/project-command-runner";
import { type ProjectRegistryService } from "../services/project-registry";
import type { ProjectActionName } from "../types/project";

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

function parseActionName(value: string): ProjectActionName {
  if (value !== "start" && value !== "stop" && value !== "restart") {
    throw new HttpError(404, `Unknown project action "${value}".`);
  }

  return value;
}

export function createProjectActionsRouter(options: {
  registryService: ProjectRegistryService;
  actionHistoryService?: ActionHistoryService;
}) {
  const projectActionsRouter = Router({ mergeParams: true });
  const registryService = options.registryService;
  const actionHistoryService = options.actionHistoryService ?? new ActionHistoryService();
  const runtimeDir = path.join(path.dirname(registryService.getRegistryPath()), "runtime");

  projectActionsRouter.post(
    "/:action",
    handleAsync(async (request, response) => {
      const action = parseActionName(request.params.action);
      const project = await registryService.getProject(request.params.id);
      const commandResult = await executeProjectAction(project, action, {
        runtimeDir,
      });
      await actionHistoryService.appendEntry({
        kind: "project_action",
        ok: commandResult.ok,
        projects: [
          {
            id: project.id,
            name: project.name,
          },
        ],
        summary: `${project.name} ${action} ${commandResult.ok ? "成功" : "失败"}`,
        detail: commandResult.ok
          ? `${action} command completed in ${commandResult.durationMs}ms.`
          : `${action} command failed in ${commandResult.durationMs}ms.`,
        command: commandResult.command,
        stdout: commandResult.stdout,
        stderr: commandResult.stderr,
        durationMs: commandResult.durationMs,
        actionName: action,
      });
      const registry = await registryService.readRegistry();
      const list = await buildProjectListResponse(registry);
      const item = list.items.find((entry) => entry.id === project.id) ?? null;

      response.json({
        ok: commandResult.ok,
        action,
        projectId: project.id,
        result: commandResult,
        item,
      });
    }),
  );

  return projectActionsRouter;
}

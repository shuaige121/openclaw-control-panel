import { Router, type NextFunction, type Request, type Response } from "express";
import { ActionHistoryService } from "../services/action-history";
import { getAgents } from "../services/project-agents";
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

export function createAgentsRouter(options: {
  registryService: ProjectRegistryService;
  actionHistoryService?: ActionHistoryService;
}) {
  const agentsRouter = Router();
  const registryService = options.registryService;

  agentsRouter.get(
    "/:id/agents",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      const agents = await getAgents(project.paths.configPath);

      response.json(agents);
    }),
  );

  return agentsRouter;
}

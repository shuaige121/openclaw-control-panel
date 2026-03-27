import { Router, type NextFunction, type Request, type Response } from "express";
import { HttpError } from "../lib/http-error";
import {
  getChannels,
  updateChannel,
} from "../services/project-channels";
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

function parseChannelConfigBody(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "channel config body must be an object.");
  }

  return value as Record<string, unknown>;
}

export function createChannelsRouter(options: {
  registryService: ProjectRegistryService;
  actionHistoryService?: ActionHistoryService;
}) {
  const channelsRouter = Router();
  const registryService = options.registryService;

  channelsRouter.get(
    "/:id/channels",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      const channels = await getChannels(project.paths.configPath);

      response.json(channels);
    }),
  );

  channelsRouter.put(
    "/:id/channels/:channelType",
    handleAsync(async (request, response) => {
      const project = await registryService.getProject(request.params.id);
      const config = parseChannelConfigBody(request.body);

      await updateChannel(project.paths.configPath, request.params.channelType, config);

      response.sendStatus(200);
    }),
  );

  return channelsRouter;
}

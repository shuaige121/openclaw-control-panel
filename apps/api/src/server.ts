import fs from "node:fs";
import path from "node:path";
import express, {
  type NextFunction,
  type Request,
  type Response
} from "express";

import { HttpError } from "./lib/http-error";
import { createIpAllowlistMiddleware } from "./lib/ip-allowlist";
import { WEB_DIST_DIR } from "./paths";
import { createActionsRouter } from "./routes/actions";
import { createAgentsRouter } from "./routes/agents";
import { createBulkRouter } from "./routes/bulk";
import { healthRouter } from "./routes/health";
import { createChannelsRouter } from "./routes/channels";
import { createFilesRouter } from "./routes/files";
import { createProjectActionsRouter } from "./routes/project-actions";
import { createProjectsRouter } from "./routes/projects";
import { ActionHistoryService } from "./services/action-history";
import type { CreateInstanceRuntimeOptions } from "./services/instance-creator";
import { ProjectRegistryService } from "./services/project-registry";

type AccessControlOptions = {
  allowedIps?: string[];
  trustProxy?: boolean;
};

type CreateServerOptions = {
  registryService?: ProjectRegistryService;
  actionHistoryService?: ActionHistoryService;
  serveWeb?: boolean;
  webDistDir?: string;
  accessControl?: AccessControlOptions;
  instanceCreatorOptions?: CreateInstanceRuntimeOptions;
};

export function createServer(options: CreateServerOptions = {}) {
  const app = express();
  const registryService = options.registryService ?? new ProjectRegistryService();
  const actionHistoryService = options.actionHistoryService ?? new ActionHistoryService();
  const webDistDir = options.webDistDir ?? WEB_DIST_DIR;
  const serveWeb = options.serveWeb ?? true;
  const webIndexPath = path.join(webDistDir, "index.html");
  const hasBuiltWeb = serveWeb && fs.existsSync(webIndexPath);
  const accessControl = options.accessControl ?? {};

  app.disable("x-powered-by");
  app.set("trust proxy", accessControl.trustProxy ?? false);
  app.use(express.json());
  app.use(
    createIpAllowlistMiddleware({
      allowlist: accessControl.allowedIps ?? [],
    }),
  );

  app.use("/api/actions", createActionsRouter({ actionHistoryService }));
  app.use("/api/health", healthRouter);
  app.use("/api/bulk", createBulkRouter({ registryService, actionHistoryService }));
  app.use(
    "/api/projects",
    createAgentsRouter({ registryService, actionHistoryService }),
  );
  app.use(
    "/api/projects",
    createChannelsRouter({ registryService, actionHistoryService }),
  );
  app.use(
    "/api/projects",
    createFilesRouter({ registryService, actionHistoryService }),
  );
  app.use(
    "/api/projects/:id/actions",
    createProjectActionsRouter({ registryService, actionHistoryService }),
  );
  app.use(
    "/api/projects",
    createProjectsRouter({
      registryService,
      actionHistoryService,
      instanceCreatorOptions: options.instanceCreatorOptions,
    }),
  );

  if (hasBuiltWeb) {
    app.use(express.static(webDistDir));
    app.get(/^\/(?!api\/).*/, (_request, response) => {
      response.sendFile(webIndexPath);
    });
  }

  app.use((_request: Request, response: Response) => {
    response.status(404).json({
      error: {
        message: "Route not found"
      }
    });
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction
    ) => {
      if (error instanceof HttpError) {
        response.status(error.statusCode).json({
          error: {
            message: error.message
          }
        });
        return;
      }

      console.error("Unhandled API error", error);
      response.status(500).json({
        error: {
          message: "Internal server error"
        }
      });
    }
  );

  return app;
}

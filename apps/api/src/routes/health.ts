import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_request, response) => {
  response.json({
    ok: true,
    service: "openclaw-control-panel-api",
    time: new Date().toISOString(),
  });
});

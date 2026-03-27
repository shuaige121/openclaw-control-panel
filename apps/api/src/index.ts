import { parseAllowedIpsFromEnv } from "./lib/ip-allowlist";
import {
  assertSafeManagerBinding,
  isLoopbackHost,
  resolveHost,
  resolvePort,
} from "./lib/startup-config";
import { createServer } from "./server";
import { ActionHistoryService } from "./services/action-history";
import {
  ManagerTelegramBotService,
  readManagerTelegramBotConfig,
} from "./services/manager-telegram-bot";
import { ProjectRegistryService } from "./services/project-registry";

const port = resolvePort(process.env.PORT);
const host = resolveHost(process.env.HOST);
const allowedIps = parseAllowedIpsFromEnv(process.env);
const allowUnsafeBind = process.env.MANAGER_ALLOW_UNSAFE_BIND === "1";
const registryService = new ProjectRegistryService();
const actionHistoryService = new ActionHistoryService();

assertSafeManagerBinding({
  host,
  allowedIps,
  allowUnsafeBind,
});

const app = createServer({
  registryService,
  actionHistoryService,
  accessControl: {
    allowedIps,
    trustProxy: process.env.MANAGER_TRUST_PROXY === "1",
  },
  instanceCreatorOptions: {
    uvBin: process.env.UV_BIN || undefined,
  },
});
const managerTelegramBotConfig = readManagerTelegramBotConfig(process.env);

app.listen(port, host, () => {
  console.log(`OpenClaw Control Panel API listening on http://${host}:${port}`);

  if (allowUnsafeBind && !isLoopbackHost(host) && allowedIps.length === 0) {
    console.warn(
      `[security] MANAGER_ALLOW_UNSAFE_BIND=1 allows binding ${host} without MANAGER_ALLOWED_IPS. Only use this on a trusted network.`,
    );
  }

  if (managerTelegramBotConfig) {
    const botService = new ManagerTelegramBotService({
      token: managerTelegramBotConfig.token,
      allowedUserIds: managerTelegramBotConfig.allowedUserIds,
      apiBaseUrl: managerTelegramBotConfig.apiBaseUrl,
      pollTimeoutSeconds: managerTelegramBotConfig.pollTimeoutSeconds,
      registryService,
      actionHistoryService,
    });
    botService.start();
    console.log("[manager-telegram-bot] polling started");
  }
});

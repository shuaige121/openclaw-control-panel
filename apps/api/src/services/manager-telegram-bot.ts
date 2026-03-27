import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ActionHistoryService } from "./action-history";
import { scanProjectCompatibility } from "./project-compatibility";
import { buildProjectListItem, buildProjectListResponse } from "./project-probe";
import { executeProjectAction } from "./project-command-runner";
import { ProjectRegistryService } from "./project-registry";
import { ManagerTelegramStateService } from "./manager-telegram-state";
import type { ProjectActionName } from "../types/project";

type TelegramChat = {
  id: number;
};

type TelegramUser = {
  id: number;
};

type TelegramMessage = {
  message_id: number;
  chat?: TelegramChat;
  from?: TelegramUser;
  text?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result: T;
};

type ManagerTelegramBotOptions = {
  token: string;
  allowedUserIds: string[];
  registryService: ProjectRegistryService;
  actionHistoryService: ActionHistoryService;
  stateService?: ManagerTelegramStateService;
  apiBaseUrl?: string;
  pollTimeoutSeconds?: number;
};

type ParsedTelegramCommand = {
  command: string;
  args: string[];
};

export type ManagerTelegramBotRuntimeConfig = {
  token: string;
  allowedUserIds: string[];
  apiBaseUrl: string;
  pollTimeoutSeconds: number;
};

function normalizeCommandToken(token: string): string {
  const baseToken = token.trim().split("@", 1)[0] ?? token.trim();
  return baseToken.toLowerCase();
}

function parseCommand(text: string): ParsedTelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 0) {
    return null;
  }

  return {
    command: normalizeCommandToken(parts[0]),
    args: parts.slice(1),
  };
}

function formatProjectStatusLine(project: Awaited<ReturnType<typeof buildProjectListResponse>>["items"][number]): string {
  return `- ${project.id}: ${project.runtimeStatus} / ${project.healthStatus} (port ${project.gatewayPort})`;
}

async function safeTelegramApiCall<T>(
  apiBaseUrl: string,
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed with ${response.status}.`);
  }

  const payload = (await response.json()) as TelegramApiResponse<T>;
  if (!payload.ok) {
    throw new Error(`Telegram API ${method} returned ok=false.`);
  }

  return payload.result;
}

export function readManagerTelegramBotConfig(
  env: NodeJS.ProcessEnv = process.env,
): ManagerTelegramBotRuntimeConfig | null {
  const token = env.MANAGER_TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const rawAllowedUserIds = env.MANAGER_TELEGRAM_ALLOWED_USER_IDS?.trim() ?? "";

  if (token.length === 0 || rawAllowedUserIds.length === 0) {
    return null;
  }

  const allowedUserIds = rawAllowedUserIds
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (allowedUserIds.length === 0) {
    return null;
  }

  return {
    token,
    allowedUserIds,
    apiBaseUrl: env.MANAGER_TELEGRAM_API_BASE_URL?.trim() || "https://api.telegram.org",
    pollTimeoutSeconds: Number.parseInt(env.MANAGER_TELEGRAM_POLL_TIMEOUT_SECONDS ?? "25", 10) || 25,
  };
}

export class ManagerTelegramBotService {
  private readonly token: string;
  private readonly allowedUserIds: Set<string>;
  private readonly registryService: ProjectRegistryService;
  private readonly actionHistoryService: ActionHistoryService;
  private readonly stateService: ManagerTelegramStateService;
  private readonly apiBaseUrl: string;
  private readonly pollTimeoutSeconds: number;
  private readonly runtimeDir: string;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(options: ManagerTelegramBotOptions) {
    this.token = options.token;
    this.allowedUserIds = new Set(options.allowedUserIds);
    this.registryService = options.registryService;
    this.actionHistoryService = options.actionHistoryService;
    this.stateService = options.stateService ?? new ManagerTelegramStateService();
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.telegram.org";
    this.pollTimeoutSeconds = options.pollTimeoutSeconds ?? 25;
    this.runtimeDir = path.join(path.dirname(this.registryService.getRegistryPath()), "runtime");
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const offset = await this.stateService.readOffset();
        const updates = await safeTelegramApiCall<TelegramUpdate[]>(
          this.apiBaseUrl,
          this.token,
          "getUpdates",
          {
            offset,
            timeout: this.pollTimeoutSeconds,
            allowed_updates: ["message"],
          },
        );

        for (const update of updates) {
          await this.stateService.writeOffset(update.update_id + 1);
          await this.handleUpdate(update);
        }
      } catch (error) {
        console.error("[manager-telegram-bot] polling failed", error);
        await sleep(3000);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    const text = message?.text?.trim();
    const chatId = message?.chat?.id;
    const fromUserId = message?.from?.id;

    if (!text || typeof chatId !== "number" || typeof fromUserId !== "number") {
      return;
    }

    if (!this.allowedUserIds.has(String(fromUserId))) {
      return;
    }

    const parsedCommand = parseCommand(text);
    if (!parsedCommand) {
      return;
    }

    try {
      const replyText = await this.executeCommand(parsedCommand);
      await this.sendMessage(chatId, replyText);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown Control Panel bot error.";
      await this.sendMessage(chatId, `操作失败: ${messageText}`);
    }
  }

  private async executeCommand(parsedCommand: ParsedTelegramCommand): Promise<string> {
    switch (parsedCommand.command) {
      case "/help":
      case "/start":
        return [
          "OpenClaw Control Panel bot commands:",
          "/projects",
          "/status <projectId>",
          "/start <projectId>",
          "/stop <projectId>",
          "/restart <projectId>",
          "/scan <projectId>",
        ].join("\n");
      case "/projects":
        return await this.handleProjectsCommand();
      case "/status":
        return await this.handleStatusCommand(parsedCommand.args);
      case "/scan":
        return await this.handleScanCommand(parsedCommand.args);
      case "/stop":
      case "/restart":
        return await this.handleProjectActionCommand(
          parsedCommand.command.slice(1) as ProjectActionName,
          parsedCommand.args,
        );
      default:
        if (parsedCommand.command === "/start" && parsedCommand.args.length > 0) {
          return await this.handleProjectActionCommand("start", parsedCommand.args);
        }

        return `未知命令: ${parsedCommand.command}`;
    }
  }

  private async handleProjectsCommand(): Promise<string> {
    const registry = await this.registryService.readRegistry();
    const list = await buildProjectListResponse(registry);

    if (list.items.length === 0) {
      return "当前还没有注册任何项目。";
    }

    return [
      `Projects: ${list.summary.totalProjects}`,
      ...list.items.map((project) => formatProjectStatusLine(project)),
    ].join("\n");
  }

  private async handleStatusCommand(args: string[]): Promise<string> {
    const projectId = args[0]?.trim();
    if (!projectId) {
      throw new Error("用法: /status <projectId>");
    }

    const registry = await this.registryService.readRegistry();
    const projectRecord = registry.projects.find((entry) => entry.id === projectId);

    if (!projectRecord) {
      throw new Error(`未找到项目 ${projectId}`);
    }

    const project = await buildProjectListItem(projectRecord, registry);

    return [
      `Project: ${project.name} (${project.id})`,
      `Runtime: ${project.runtimeStatus}`,
      `Health: ${project.healthStatus}`,
      `Gateway: ${project.endpoints.gatewayUrl}`,
      `Auth: ${project.auth.label}`,
      `Compatibility: ${project.compatibility.status}`,
    ].join("\n");
  }

  private async handleScanCommand(args: string[]): Promise<string> {
    const projectId = args[0]?.trim();
    if (!projectId) {
      throw new Error("用法: /scan <projectId>");
    }

    const project = await this.registryService.getProject(projectId);
    const compatibility = await scanProjectCompatibility(project);
    const updatedProject = await this.registryService.updateProjectCompatibility(project.id, compatibility);

    await this.actionHistoryService.appendEntry({
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

    return `兼容性已更新: ${updatedProject.id} -> ${updatedProject.compatibility.status}`;
  }

  private async handleProjectActionCommand(
    action: ProjectActionName,
    args: string[],
  ): Promise<string> {
    const projectId = args[0]?.trim();
    if (!projectId) {
      throw new Error(`用法: /${action} <projectId>`);
    }

    const project = await this.registryService.getProject(projectId);
    const commandResult = await executeProjectAction(project, action, {
      runtimeDir: this.runtimeDir,
    });

    await this.actionHistoryService.appendEntry({
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

    const detail = commandResult.stderr || commandResult.stdout || "命令已执行。";
    return `${project.id} ${action} ${commandResult.ok ? "完成" : "失败"}\n${detail}`;
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    await safeTelegramApiCall(
      this.apiBaseUrl,
      this.token,
      "sendMessage",
      {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      },
    );
  }
}

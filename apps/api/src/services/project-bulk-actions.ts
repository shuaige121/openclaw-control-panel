import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { HttpError } from "../lib/http-error";
import { assertConfigFieldValid } from "./project-config-validator";
import { readProjectMemoryProfile } from "./project-memory-mode";
import type {
  BulkActionProjectResult,
  BulkActionName,
  StoredProjectRecord,
} from "../types/project";

type HookBulkPayload = {
  mode: "enable" | "disable";
  hookName: string;
};

type SkillBulkPayload = {
  mode: "enable" | "disable";
  skillName: string;
};

type MemoryBulkPayload =
  | {
      mode: "append";
      content: string;
      blockId?: string;
    }
  | {
      mode: "remove";
      blockId: string;
    };

type ConfigBulkPayload =
  | {
      mode: "set";
      path: string;
      value: unknown;
    }
  | {
      mode: "delete";
      path: string;
    };

type BulkActionRequest =
  | {
      projectIds: string[];
      action: "hooks";
      payload: HookBulkPayload;
    }
  | {
      projectIds: string[];
      action: "skills";
      payload: SkillBulkPayload;
    }
  | {
      projectIds: string[];
      action: "memory";
      payload: MemoryBulkPayload;
    }
  | {
      projectIds: string[];
      action: "config";
      payload: ConfigBulkPayload;
    };

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new HttpError(400, `${fieldName} must be an object.`);
  }

  return value;
}

function expectString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function expectStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, `${fieldName} must be a non-empty array of strings.`);
  }

  return value.map((entry, index) => expectString(entry, `${fieldName}[${index}]`));
}

function expectAction(value: unknown): BulkActionName {
  if (value !== "hooks" && value !== "skills" && value !== "memory" && value !== "config") {
    throw new HttpError(400, "action must be one of hooks, skills, memory, config.");
  }

  return value;
}

function parseBulkRequest(value: unknown): BulkActionRequest {
  const object = expectObject(value, "bulkAction");
  const action = expectAction(object.action);
  const projectIds = expectStringArray(object.projectIds, "bulkAction.projectIds");
  const payload = expectObject(object.payload, "bulkAction.payload");

  if (action === "hooks") {
    const mode = payload.mode;
    if (mode !== "enable" && mode !== "disable") {
      throw new HttpError(400, "bulkAction.payload.mode must be enable or disable for hooks.");
    }
    return {
      projectIds,
      action,
      payload: {
        mode,
        hookName: expectString(payload.hookName, "bulkAction.payload.hookName"),
      },
    };
  }

  if (action === "skills") {
    const mode = payload.mode;
    if (mode !== "enable" && mode !== "disable") {
      throw new HttpError(400, "bulkAction.payload.mode must be enable or disable for skills.");
    }
    return {
      projectIds,
      action,
      payload: {
        mode,
        skillName: expectString(payload.skillName, "bulkAction.payload.skillName"),
      },
    };
  }

  if (action === "memory") {
    const mode = payload.mode;
    if (mode === "append") {
      return {
        projectIds,
        action,
        payload: {
          mode,
          content: expectString(payload.content, "bulkAction.payload.content"),
          blockId:
            payload.blockId === undefined
              ? undefined
              : expectString(payload.blockId, "bulkAction.payload.blockId"),
        },
      };
    }

    if (mode === "remove") {
      return {
        projectIds,
        action,
        payload: {
          mode,
          blockId: expectString(payload.blockId, "bulkAction.payload.blockId"),
        },
      };
    }

    throw new HttpError(400, "bulkAction.payload.mode must be append or remove for memory.");
  }

  const mode = payload.mode;
  if (mode === "set") {
    return {
      projectIds,
      action,
      payload: {
        mode,
        path: expectString(payload.path, "bulkAction.payload.path"),
        value: payload.value,
      },
    };
  }

  if (mode === "delete") {
    return {
      projectIds,
      action,
      payload: {
        mode,
        path: expectString(payload.path, "bulkAction.payload.path"),
      },
    };
  }

  throw new HttpError(400, "bulkAction.payload.mode must be set or delete for config.");
}

export function describeBulkActionRequest(value: unknown): {
  action: BulkActionName;
  projectIds: string[];
  actionName: string;
  detail: string;
} {
  const request = parseBulkRequest(value);

  if (request.action === "hooks") {
    return {
      action: request.action,
      projectIds: request.projectIds,
      actionName: "bulk_hooks",
      detail: `Hook ${request.payload.hookName} -> ${request.payload.mode}`,
    };
  }

  if (request.action === "skills") {
    return {
      action: request.action,
      projectIds: request.projectIds,
      actionName: "bulk_skills",
      detail: `Skill ${request.payload.skillName} -> ${request.payload.mode}`,
    };
  }

  if (request.action === "memory") {
    return {
      action: request.action,
      projectIds: request.projectIds,
      actionName: "bulk_memory",
      detail:
        request.payload.mode === "append"
          ? `Memory append block ${request.payload.blockId ?? "auto-generated"}`
          : `Memory remove block ${request.payload.blockId}`,
    };
  }

  return {
    action: request.action,
    projectIds: request.projectIds,
    actionName: "bulk_config",
    detail:
      request.payload.mode === "set"
        ? `Config set ${request.payload.path}`
        : `Config delete ${request.payload.path}`,
  };
}

function splitPathSegments(rawPath: string): string[] {
  const segments = rawPath
    .split(".")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (segments.length === 0) {
    throw new HttpError(400, "bulkAction.payload.path must not be empty.");
  }

  return segments;
}

function ensureJsonObject(value: unknown, fieldName: string): JsonObject {
  if (!isObject(value)) {
    throw new HttpError(500, `${fieldName} must be a JSON object.`);
  }

  return value;
}

function setNestedValue(root: JsonObject, rawPath: string, nextValue: unknown): void {
  const segments = splitPathSegments(rawPath);
  let current: JsonObject = root;

  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];
    if (!isObject(child)) {
      current[segment] = {};
    }
    current = ensureJsonObject(current[segment], `config.${segment}`);
  }

  current[segments.at(-1)!] = nextValue;
}

function deleteNestedValue(root: JsonObject, rawPath: string): boolean {
  const segments = splitPathSegments(rawPath);
  let current: JsonObject = root;

  for (const segment of segments.slice(0, -1)) {
    const child = current[segment];
    if (!isObject(child)) {
      return false;
    }
    current = child;
  }

  const lastSegment = segments.at(-1)!;
  if (!(lastSegment in current)) {
    return false;
  }

  delete current[lastSegment];
  return true;
}

async function readConfig(project: StoredProjectRecord): Promise<JsonObject> {
  const raw = await fs.readFile(project.paths.configPath, "utf8");
  return ensureJsonObject(JSON.parse(raw) as unknown, "config");
}

async function writeConfig(project: StoredProjectRecord, config: JsonObject): Promise<void> {
  await fs.writeFile(project.paths.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function applyHookAction(
  project: StoredProjectRecord,
  payload: HookBulkPayload,
): Promise<string> {
  const config = await readConfig(project);
  const enabled = payload.mode === "enable";

  if (enabled) {
    setNestedValue(config, "hooks.internal.enabled", true);
  }

  setNestedValue(config, `hooks.internal.entries.${payload.hookName}.enabled`, enabled);
  await writeConfig(project, config);

  return `Hook ${payload.hookName} 已${enabled ? "启用" : "禁用"}。`;
}

async function applySkillAction(
  project: StoredProjectRecord,
  payload: SkillBulkPayload,
): Promise<string> {
  const config = await readConfig(project);
  const enabled = payload.mode === "enable";

  setNestedValue(config, `skills.entries.${payload.skillName}.enabled`, enabled);
  await writeConfig(project, config);

  return `Skill ${payload.skillName} 已${enabled ? "启用" : "禁用"}。`;
}

function buildMemoryBlock(blockId: string, content: string): string {
  return [
    `<!-- openclaw-manager:block:${blockId} -->`,
    content.trim(),
    `<!-- /openclaw-manager:block:${blockId} -->`,
  ].join("\n");
}

function removeMemoryBlock(content: string, blockId: string): string {
  const escapedBlockId = blockId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\n?<!-- openclaw-manager:block:${escapedBlockId} -->[\\s\\S]*?<!-- /openclaw-manager:block:${escapedBlockId} -->\\n?`,
    "g",
  );

  return content.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

async function applyMemoryAction(
  project: StoredProjectRecord,
  payload: MemoryBulkPayload,
): Promise<string> {
  const memoryPath = path.join(project.paths.workspacePath, "MEMORY.md");
  await fs.mkdir(project.paths.workspacePath, { recursive: true });

  let currentContent = "";
  try {
    currentContent = await fs.readFile(memoryPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  if (payload.mode === "append") {
    const blockId = payload.blockId ?? `mgr-${crypto.randomUUID()}`;
    const nextBlock = buildMemoryBlock(blockId, payload.content);
    const nextContent =
      currentContent.trim().length === 0 ? `${nextBlock}\n` : `${currentContent.trimEnd()}\n\n${nextBlock}\n`;
    await fs.writeFile(memoryPath, nextContent, "utf8");
    return `记忆块 ${blockId} 已追加到 MEMORY.md。`;
  }

  const nextContent = removeMemoryBlock(currentContent, payload.blockId);
  if (nextContent === currentContent.trimEnd()) {
    throw new HttpError(404, `Memory block ${payload.blockId} was not found.`);
  }

  await fs.writeFile(memoryPath, `${nextContent}\n`, "utf8");
  return `记忆块 ${payload.blockId} 已从 MEMORY.md 删除。`;
}

async function applyConfigAction(
  project: StoredProjectRecord,
  payload: ConfigBulkPayload,
): Promise<string> {
  const config = await readConfig(project);

  if (payload.mode === "set") {
    assertConfigFieldValid(payload.path, payload.value);
    setNestedValue(config, payload.path, payload.value);
    await writeConfig(project, config);
    return `配置 ${payload.path} 已写入。`;
  }

  const removed = deleteNestedValue(config, payload.path);
  if (!removed) {
    throw new HttpError(404, `Config path ${payload.path} was not found.`);
  }

  await writeConfig(project, config);
  return `配置 ${payload.path} 已删除。`;
}

async function applyProjectAction(
  project: StoredProjectRecord,
  request: BulkActionRequest,
): Promise<BulkActionProjectResult> {
  try {
    let message = "";

    if (request.action === "hooks") {
      message = await applyHookAction(project, request.payload);
    } else if (request.action === "skills") {
      message = await applySkillAction(project, request.payload);
    } else if (request.action === "memory") {
      const memoryProfile = await readProjectMemoryProfile(project);
      if (memoryProfile.mode !== "normal") {
        throw new HttpError(
          409,
          `Project memory mode is ${memoryProfile.mode}; manager memory writes are blocked.`,
        );
      }
      message = await applyMemoryAction(project, request.payload);
    } else {
      message = await applyConfigAction(project, request.payload);
    }

    return {
      projectId: project.id,
      projectName: project.name,
      ok: true,
      message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bulk action error.";
    return {
      projectId: project.id,
      projectName: project.name,
      ok: false,
      message,
    };
  }
}

export async function executeBulkAction(
  projects: StoredProjectRecord[],
  value: unknown,
): Promise<{
  action: BulkActionName;
  projectIds: string[];
  results: BulkActionProjectResult[];
}> {
  const request = parseBulkRequest(value);
  const requestedIds = new Set(request.projectIds);
  const matchedProjects = projects.filter((project) => requestedIds.has(project.id));

  if (matchedProjects.length !== request.projectIds.length) {
    const missingIds = request.projectIds.filter((projectId) => !matchedProjects.some((p) => p.id === projectId));
    throw new HttpError(404, `Unknown project ids: ${missingIds.join(", ")}`);
  }

  const results = await Promise.all(matchedProjects.map((project) => applyProjectAction(project, request)));

  return {
    action: request.action,
    projectIds: request.projectIds,
    results,
  };
}

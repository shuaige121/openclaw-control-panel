import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../lib/http-error";

type JsonObject = Record<string, unknown>;

const MANAGED_SECTION_START = "<!-- managed:attached-files -->";
const MANAGED_SECTION_END = "<!-- /managed:attached-files -->";

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isSymlink(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(targetPath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function collectFiles(
  dirPath: string,
  baseName: string,
  extensions: string[] = [".md", ".txt", ".json", ".csv", ".html", ".pdf"],
): Promise<{ relativePath: string; firstLine: string }[]> {
  const results: { relativePath: string; firstLine: string }[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.includes(ext)) continue;

      const relativePath = path.join(baseName, path.relative(dirPath, fullPath));
      let firstLine = "";

      try {
        const content = await fs.readFile(fullPath, "utf8");
        const line = content.split("\n").find((l) => l.trim().length > 0);
        firstLine = (line ?? "").replace(/^#+\s*/, "").trim().slice(0, 80);
      } catch {
        firstLine = "(unreadable)";
      }

      results.push({ relativePath, firstLine });
    }
  }

  await walk(dirPath);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

function buildManagedSection(
  attachments: { name: string; sourcePath: string; description?: string; files: { relativePath: string; firstLine: string }[] }[],
): string {
  if (attachments.length === 0) return "";

  const lines: string[] = [MANAGED_SECTION_START, ""];

  for (const att of attachments) {
    const header = att.description
      ? `## ${att.name} — ${att.description}`
      : `## ${att.name}`;
    lines.push(header);
    lines.push(`来源: \`${att.sourcePath}\``);

    for (const file of att.files) {
      const desc = file.firstLine ? ` — ${file.firstLine}` : "";
      lines.push(`- \`${file.relativePath}\`${desc}`);
    }

    lines.push("");
  }

  lines.push(MANAGED_SECTION_END);
  return lines.join("\n");
}

async function updateManagedMarkdownSection(
  filePath: string,
  attachments: { name: string; sourcePath: string; description?: string; files: { relativePath: string; firstLine: string }[] }[],
): Promise<void> {
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    content = "";
  }

  const startIdx = content.indexOf(MANAGED_SECTION_START);
  const endIdx = content.indexOf(MANAGED_SECTION_END);

  const section = buildManagedSection(attachments);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = content.slice(0, startIdx).trimEnd();
    const after = content.slice(endIdx + MANAGED_SECTION_END.length).trimStart();
    const parts = [before, section, after].filter((s) => s.length > 0);
    content = parts.join("\n\n") + "\n";
  } else if (section.length > 0) {
    content = content.trimEnd() + "\n\n" + section + "\n";
  }

  await fs.writeFile(filePath, content, "utf8");
}

function ensureToolsInConfig(config: JsonObject): { changed: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let changed = false;

  const agents = isObject(config.agents) ? config.agents : {};
  const agentList = Array.isArray(agents.list) ? agents.list : [];

  if (agentList.length === 0) {
    return { changed, warnings };
  }

  const agent = isObject(agentList[0]) ? agentList[0] : {};
  const tools = isObject(agent.tools) ? agent.tools : {};
  const allow = Array.isArray(tools.allow) ? (tools.allow as string[]) : [];

  const requiredTools = ["read", "exec"];
  const missing = requiredTools.filter(
    (t) => !allow.some((a) => a.toLowerCase() === t),
  );

  if (missing.length > 0) {
    const newAllow = [...allow, ...missing];
    agent.tools = { ...tools, allow: newAllow, deny: tools.deny ?? ["*"] };
    agentList[0] = agent;
    agents.list = agentList;
    config.agents = agents;
    changed = true;
  }

  const sandbox = isObject(agent.sandbox) ? agent.sandbox : {};
  if (sandbox.mode === "all") {
    warnings.push(
      'sandbox.mode is "all" — symlinked files may not be visible inside the sandbox. Consider setting sandbox.mode to "off".',
    );
  }

  return { changed, warnings };
}

export interface AttachResult {
  name: string;
  workspacePath: string;
  sourcePath: string;
  mode: "symlink" | "copy";
  fileCount: number;
  warnings: string[];
  toolsUpdated: boolean;
}

export async function attachFileToWorkspace(options: {
  workspacePath: string;
  configPath: string;
  sourcePath: string;
  name?: string;
  mode?: "symlink" | "copy";
  description?: string;
  ensureTools?: boolean;
}): Promise<AttachResult> {
  const sourcePath = path.resolve(options.sourcePath);
  const name = options.name ?? path.basename(sourcePath);
  const mode = options.mode ?? "symlink";
  const workspacePath = options.workspacePath;
  const targetPath = path.join(workspacePath, name);

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new HttpError(400, `Invalid attachment name "${name}". Use alphanumeric, dots, hyphens, underscores.`);
  }

  if (!await pathExists(sourcePath)) {
    throw new HttpError(400, `Source path does not exist: ${sourcePath}`);
  }

  if (await pathExists(targetPath)) {
    throw new HttpError(409, `"${name}" already exists in workspace.`);
  }

  if (!await pathExists(workspacePath)) {
    throw new HttpError(500, `Workspace path does not exist: ${workspacePath}`);
  }

  if (mode === "symlink") {
    await fs.symlink(sourcePath, targetPath);
  } else {
    await fs.cp(sourcePath, targetPath, { recursive: true });
  }

  const files = await collectFiles(
    mode === "symlink" ? sourcePath : targetPath,
    name,
  );

  const allAttachments = await listAttachments(workspacePath);
  const thisAttachment = {
    name,
    sourcePath,
    description: options.description,
    files,
  };
  const existingIdx = allAttachments.findIndex((a) => a.name === name);
  if (existingIdx !== -1) {
    allAttachments[existingIdx] = thisAttachment;
  } else {
    allAttachments.push(thisAttachment);
  }

  const memoryPath = path.join(workspacePath, "MEMORY.md");
  const toolsPath = path.join(workspacePath, "TOOLS.md");

  await updateManagedMarkdownSection(memoryPath, allAttachments);
  await updateManagedMarkdownSection(toolsPath, allAttachments);

  let toolsUpdated = false;
  const warnings: string[] = [];

  if (options.ensureTools !== false) {
    const raw = await fs.readFile(options.configPath, "utf8");
    const config = JSON.parse(raw) as JsonObject;
    const result = ensureToolsInConfig(config);
    warnings.push(...result.warnings);

    if (result.changed) {
      await fs.writeFile(options.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      toolsUpdated = true;
    }
  }

  return {
    name,
    workspacePath: targetPath,
    sourcePath,
    mode,
    fileCount: files.length,
    warnings,
    toolsUpdated,
  };
}

export interface AttachmentInfo {
  name: string;
  sourcePath: string;
  description?: string;
  files: { relativePath: string; firstLine: string }[];
}

async function listAttachments(workspacePath: string): Promise<AttachmentInfo[]> {
  const entries = await fs.readdir(workspacePath, { withFileTypes: true });
  const attachments: AttachmentInfo[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const fullPath = path.join(workspacePath, entry.name);
    const isLink = await isSymlink(fullPath);

    if (!isLink) continue;

    let sourcePath = "";
    try {
      sourcePath = await fs.readlink(fullPath);
    } catch {
      continue;
    }

    const files = await collectFiles(fullPath, entry.name);
    attachments.push({ name: entry.name, sourcePath, files });
  }

  return attachments;
}

export async function listWorkspaceFiles(workspacePath: string): Promise<{
  attachments: { name: string; sourcePath: string; mode: string; fileCount: number }[];
}> {
  const entries = await fs.readdir(workspacePath, { withFileTypes: true });
  const attachments: { name: string; sourcePath: string; mode: string; fileCount: number }[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const fullPath = path.join(workspacePath, entry.name);
    const isLink = await isSymlink(fullPath);

    if (!isLink) continue;

    let sourcePath = "";
    try {
      sourcePath = await fs.readlink(fullPath);
    } catch {
      continue;
    }

    const files = await collectFiles(fullPath, entry.name);
    attachments.push({
      name: entry.name,
      sourcePath,
      mode: "symlink",
      fileCount: files.length,
    });
  }

  return { attachments };
}

export async function detachFileFromWorkspace(options: {
  workspacePath: string;
  name: string;
}): Promise<void> {
  const targetPath = path.join(options.workspacePath, options.name);

  if (!await pathExists(targetPath)) {
    throw new HttpError(404, `"${options.name}" not found in workspace.`);
  }

  const isLink = await isSymlink(targetPath);

  if (isLink) {
    await fs.unlink(targetPath);
  } else {
    await fs.rm(targetPath, { recursive: true, force: true });
  }

  const allAttachments = await listAttachments(options.workspacePath);
  const memoryPath = path.join(options.workspacePath, "MEMORY.md");
  const toolsPath = path.join(options.workspacePath, "TOOLS.md");

  await updateManagedMarkdownSection(memoryPath, allAttachments);
  await updateManagedMarkdownSection(toolsPath, allAttachments);
}

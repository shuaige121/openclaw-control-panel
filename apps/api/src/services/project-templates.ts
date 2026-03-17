import {
  readProjectMemoryProfile,
  updateProjectMemoryMode,
} from "./project-memory-mode";
import {
  readProjectSandboxProfile,
  updateProjectSandboxProfile,
} from "./project-sandbox";
import type {
  ProjectTemplateDefinition,
  ProjectTemplateId,
  StoredProjectRecord,
} from "../types/project";

const PROJECT_TEMPLATE_CATALOG: ProjectTemplateDefinition[] = [
  {
    id: "general",
    name: "标准 Bot",
    summary: "默认 OpenClaw 形态，保留记忆，关闭沙箱。",
    description:
      "适合普通助手、研发协作和需要长期上下文的 bot。记忆正常启用，工具仍按各项目原本配置运行。",
    recommendedTags: ["default", "general"],
    memoryMode: "normal",
    sandbox: {
      mode: "off",
      backend: "docker",
      scope: "agent",
      workspaceAccess: "none",
    },
    notes: [
      "会把记忆模式恢复到 normal。",
      "只把 sandbox.mode 切回 off，不主动清掉你已有的 docker/ssh 细节。",
    ],
  },
  {
    id: "stateless",
    name: "无记忆 Bot",
    summary: "完全白纸，不读写记忆，适合客服、SOP 回复和固定话术机器人。",
    description:
      "每次回答尽量像首次接触一样，不沉淀长期记忆，也不读取历史 memory 插件内容。",
    recommendedTags: ["support", "stateless"],
    memoryMode: "stateless",
    sandbox: {
      mode: "off",
      backend: "docker",
      scope: "agent",
      workspaceAccess: "none",
    },
    notes: [
      "会把记忆模式切到 stateless。",
      "manager 的批量 memory 写入会被后端拒绝。",
    ],
  },
  {
    id: "sandboxed",
    name: "沙箱隔离 Bot",
    summary: "所有会话走 Docker 沙箱，默认无工作区写权限。",
    description:
      "适合要挂更多工具、但希望把工具执行隔离在容器里的 bot。默认走当前 OpenClaw 的 Docker 沙箱、session scope、workspaceAccess=none。",
    recommendedTags: ["sandbox", "isolated"],
    memoryMode: "normal",
    sandbox: {
      mode: "all",
      backend: "docker",
      scope: "session",
      workspaceAccess: "none",
    },
    notes: [
      "会把 sandbox.mode 设为 all，并沿用当前版本的默认 Docker sandbox 后端。",
      '默认把 docker.network 设为 "none"，更偏安全；需要联网工具时再单独放开。',
      "Docker 镜像默认沿用项目现有配置，没有则保持 OpenClaw 默认值。",
    ],
  },
];

function findTemplate(templateId: string): ProjectTemplateDefinition {
  const template = PROJECT_TEMPLATE_CATALOG.find((entry) => entry.id === templateId);

  if (!template) {
    throw new Error(`Unknown project template "${templateId}".`);
  }

  return template;
}

export function listProjectTemplates(): ProjectTemplateDefinition[] {
  return PROJECT_TEMPLATE_CATALOG.map((template) => structuredClone(template));
}

export async function applyProjectTemplate(
  project: StoredProjectRecord,
  templateId: ProjectTemplateId,
): Promise<{
  template: ProjectTemplateDefinition;
  memory: Awaited<ReturnType<typeof readProjectMemoryProfile>>;
  sandbox: Awaited<ReturnType<typeof readProjectSandboxProfile>>;
}> {
  const template = findTemplate(templateId);

  if (template.id === "general") {
    await updateProjectMemoryMode(project, "normal");
    await updateProjectSandboxProfile(project, {
      mode: "off",
    });
  } else if (template.id === "stateless") {
    await updateProjectMemoryMode(project, "stateless");
    await updateProjectSandboxProfile(project, {
      mode: "off",
    });
  } else {
    await updateProjectMemoryMode(project, "normal");
    await updateProjectSandboxProfile(project, {
      mode: "all",
      scope: "session",
      workspaceAccess: "none",
      dockerNetwork: "none",
    });
  }

  return {
    template,
    memory: await readProjectMemoryProfile(project),
    sandbox: await readProjectSandboxProfile(project),
  };
}

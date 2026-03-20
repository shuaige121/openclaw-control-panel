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
      "控制台的批量 memory 写入会被后端拒绝。",
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
  {
    id: "ultramarines",
    name: "Ultramarines — Standard Worldline",
    summary:
      "Full-featured OpenClaw with memory, tools, and all channels. The Codex Astartes supports this action.",
    description:
      "The default battle-brother configuration. All systems nominal — memory retention, tool access, and channel routing are fully operational. Deploy when you need a versatile, dependable worldline that follows the Codex.",
    recommendedTags: ["default", "full-featured", "codex-compliant"],
    memoryMode: "normal",
    sandbox: {
      mode: "off",
      backend: "docker",
      scope: "agent",
      workspaceAccess: "none",
    },
    notes: [
      "Restores memory mode to normal, all channels active.",
      "Sandbox is disabled — full tool access like the standard template.",
      "The Codex Astartes names this maneuver: Steel Rain.",
    ],
  },
  {
    id: "sisters-of-silence",
    name: "Sisters of Silence — Sandbox Worldline",
    summary:
      "Nullified. No external tools, no channels, no memory writes. For contained experimentation only. The silence is the point.",
    description:
      "A fully isolated worldline inspired by the psychic-null Sisters of Silence. All outbound channels are severed, tools are restricted to the sandbox, memory writes are forbidden, and workspace access is denied. Use this for untrusted prompt testing or volatile experiments.",
    recommendedTags: ["sandbox", "isolated", "null-maiden"],
    memoryMode: "locked",
    sandbox: {
      mode: "all",
      backend: "docker",
      scope: "session",
      workspaceAccess: "none",
    },
    notes: [
      "Memory mode set to locked — reads allowed, writes forbidden.",
      "Sandbox mode set to all with session scope and no workspace access.",
      'Docker network defaults to "none" — no outbound connections.',
      "The Anathema Psykana permits no warp-taint to escape containment.",
    ],
  },
  {
    id: "iron-hands",
    name: "Iron Hands — Stateless Worldline",
    summary:
      "The flesh of memory is weak. This worldline retains nothing between sessions. Pure computation, no sentiment.",
    description:
      "Memory is fully disabled. Each session starts from a blank slate with no recall of prior interactions. Tools and channels remain functional. Ideal for deterministic, repeatable workflows where accumulated context would introduce drift.",
    recommendedTags: ["stateless", "ephemeral", "iron-tenth"],
    memoryMode: "stateless",
    sandbox: {
      mode: "off",
      backend: "docker",
      scope: "agent",
      workspaceAccess: "none",
    },
    notes: [
      "Memory mode set to stateless — no reads, no writes.",
      "Sandbox remains off — tools execute normally.",
      "The Gorgon's doctrine: replace what is weak with what endures.",
    ],
  },
  {
    id: "blood-angels",
    name: "Blood Angels — Experimental Worldline",
    summary:
      "The Red Thirst demands it. High-capability model, elevated token limits, experimental tools enabled. Handle with care — the Black Rage lurks.",
    description:
      "An aggressive configuration for creative and experimental work. Memory is active to build rich context. Sandbox is disabled to allow unrestricted tool access. Pair with a high-capability model (e.g., Opus) and elevated token budgets for maximum output. Not recommended for production — the fury is difficult to contain.",
    recommendedTags: ["experimental", "creative", "high-capability"],
    memoryMode: "normal",
    sandbox: {
      mode: "off",
      backend: "docker",
      scope: "agent",
      workspaceAccess: "none",
    },
    notes: [
      "Memory mode set to normal for full context accumulation.",
      "Sandbox is off — all tools available without restriction.",
      "Recommend pairing with Opus-class model and raising token limits in project config.",
      "By the Blood of Sanguinius, the Angel's wrath is your instrument.",
    ],
  },
  {
    id: "dark-angels",
    name: "Dark Angels — Private Worldline",
    summary:
      "The Unforgiven keep their secrets. Strict access control, full audit trail, no group messages. What happens in the Inner Circle stays in the Inner Circle.",
    description:
      "A privacy-hardened worldline for sensitive operations. Memory is locked to prevent context leakage. Sandbox enforces session isolation. Designed for DM-only interactions with strict allowlists — no group channels, no shared state. Every action is auditable.",
    recommendedTags: ["private", "audit", "restricted", "inner-circle"],
    memoryMode: "locked",
    sandbox: {
      mode: "all",
      backend: "docker",
      scope: "session",
      workspaceAccess: "none",
    },
    notes: [
      "Memory mode set to locked — existing memories readable, no new writes.",
      "Sandbox mode set to all with session scope for strict isolation.",
      "Intended for DM-only channels; disable group routing in project config.",
      "Repent! For tomorrow you die. — Interrogator-Chaplain Asmodai",
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

  await updateProjectMemoryMode(project, template.memoryMode);

  if (template.sandbox.mode === "off") {
    await updateProjectSandboxProfile(project, {
      mode: "off",
    });
  } else {
    await updateProjectSandboxProfile(project, {
      mode: template.sandbox.mode,
      scope: template.sandbox.scope,
      workspaceAccess: template.sandbox.workspaceAccess,
      dockerNetwork: "none",
    });
  }

  return {
    template,
    memory: await readProjectMemoryProfile(project),
    sandbox: await readProjectSandboxProfile(project),
  };
}

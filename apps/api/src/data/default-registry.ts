import type { ProjectRegistryData } from "../types/project";

const DEFAULT_CAPABILITIES = {
  bulkHooks: true,
  bulkSkills: true,
  bulkMemory: true,
  bulkConfigPatch: true,
} as const;

function createSeedCompatibility(reason: string) {
  return {
    status: "full" as const,
    reason,
    lastScannedAt: "2026-03-17T00:00:00.000Z",
    manualOverride: null,
    checks: [
      {
        name: "lifecycle" as const,
        supported: true,
        message: "Start, stop, and restart commands are all present.",
      },
      {
        name: "gateway_probe" as const,
        supported: true,
        message: "Seed data assumes standard gateway health endpoints.",
      },
      {
        name: "web_ui" as const,
        supported: true,
        message: "Seed data assumes the standard Control UI is available.",
      },
      {
        name: "config_patch" as const,
        supported: true,
        message: "Seed data assumes the config file is readable JSON.",
      },
      {
        name: "hooks" as const,
        supported: true,
        message: "Seed data assumes hooks.internal.entries is present.",
      },
      {
        name: "skills" as const,
        supported: true,
        message: "Seed data assumes skills.entries is present.",
      },
      {
        name: "memory" as const,
        supported: true,
        message: "Seed data assumes the workspace path supports MEMORY.md operations.",
      },
    ],
  };
}

export const DEFAULT_PROJECT_REGISTRY: ProjectRegistryData = {
  version: 1,
  managerAuth: {
    strategy: "token",
    label: "默认 manager token",
    secret: "manager-demo-token-change-me",
  },
  projects: [
    {
      id: "main",
      name: "Main Assistant",
      description: "Primary production OpenClaw project for day-to-day operations.",
      gateway: {
        protocol: "http",
        host: "127.0.0.1",
        port: 18789,
      },
      tags: ["prod", "default"],
      paths: {
        rootPath: "/srv/openclaw/projects/main",
        configPath: "/srv/openclaw/projects/main/openclaw.json",
        workspacePath: "/srv/openclaw/projects/main/workspace",
      },
      auth: {
        mode: "inherit_manager",
      },
      lifecycle: {
        mode: "custom_commands",
        startCommand: "cd /srv/openclaw/projects/main && npm run gateway:start",
        stopCommand: "cd /srv/openclaw/projects/main && npm run gateway:stop",
        restartCommand: "cd /srv/openclaw/projects/main && npm run gateway:restart",
      },
      capabilities: DEFAULT_CAPABILITIES,
      compatibility: createSeedCompatibility(
        "Seed project matches the current OpenClaw manager assumptions.",
      ),
    },
    {
      id: "ops-rescue",
      name: "Ops Rescue",
      description: "Isolated rescue gateway used for break-glass maintenance and audits.",
      gateway: {
        protocol: "http",
        host: "127.0.0.1",
        port: 19001,
      },
      tags: ["ops", "rescue"],
      paths: {
        rootPath: "/srv/openclaw/projects/ops-rescue",
        configPath: "/srv/openclaw/projects/ops-rescue/openclaw.json",
        workspacePath: "/srv/openclaw/projects/ops-rescue/workspace",
      },
      auth: {
        mode: "custom",
        strategy: "token",
        label: "项目自定义 token",
        secret: "ops-rescue-demo-token-change-me",
      },
      lifecycle: {
        mode: "custom_commands",
        startCommand: "cd /srv/openclaw/projects/ops-rescue && npm run gateway:start",
        stopCommand: "cd /srv/openclaw/projects/ops-rescue && npm run gateway:stop",
        restartCommand: "cd /srv/openclaw/projects/ops-rescue && npm run gateway:restart",
      },
      capabilities: DEFAULT_CAPABILITIES,
      compatibility: createSeedCompatibility(
        "Seed project matches the current OpenClaw manager assumptions.",
      ),
    },
    {
      id: "lab-dev",
      name: "Lab Dev",
      description: "Development sandbox for prompt, skill and hook experiments.",
      gateway: {
        protocol: "http",
        host: "127.0.0.1",
        port: 19121,
      },
      tags: ["dev", "lab"],
      paths: {
        rootPath: "/srv/openclaw/projects/lab-dev",
        configPath: "/srv/openclaw/projects/lab-dev/openclaw.json",
        workspacePath: "/srv/openclaw/projects/lab-dev/workspace",
      },
      auth: {
        mode: "inherit_manager",
      },
      lifecycle: {
        mode: "custom_commands",
        startCommand: "cd /srv/openclaw/projects/lab-dev && npm run gateway:start",
        stopCommand: "cd /srv/openclaw/projects/lab-dev && npm run gateway:stop",
        restartCommand: "cd /srv/openclaw/projects/lab-dev && npm run gateway:restart",
      },
      capabilities: DEFAULT_CAPABILITIES,
      compatibility: createSeedCompatibility(
        "Seed project matches the current OpenClaw manager assumptions.",
      ),
    },
    {
      id: "qa-shadow",
      name: "QA Shadow",
      description: "Shadow environment used to rehearse config patches before production rollout.",
      gateway: {
        protocol: "http",
        host: "127.0.0.1",
        port: 19341,
      },
      tags: ["qa", "shadow"],
      paths: {
        rootPath: "/srv/openclaw/projects/qa-shadow",
        configPath: "/srv/openclaw/projects/qa-shadow/openclaw.json",
        workspacePath: "/srv/openclaw/projects/qa-shadow/workspace",
      },
      auth: {
        mode: "custom",
        strategy: "password",
        label: "项目自定义 password",
        secret: "qa-shadow-demo-password-change-me",
      },
      lifecycle: {
        mode: "custom_commands",
        startCommand: "cd /srv/openclaw/projects/qa-shadow && npm run gateway:start",
        stopCommand: "cd /srv/openclaw/projects/qa-shadow && npm run gateway:stop",
        restartCommand: "cd /srv/openclaw/projects/qa-shadow && npm run gateway:restart",
      },
      capabilities: DEFAULT_CAPABILITIES,
      compatibility: createSeedCompatibility(
        "Seed project matches the current OpenClaw manager assumptions.",
      ),
    },
  ],
};

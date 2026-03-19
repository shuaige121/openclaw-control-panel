/**
 * Pre-write validation for openclaw.json config values.
 *
 * Prevents the manager from writing values that the OpenClaw gateway
 * would reject during startup, which causes crash-loops that are hard
 * to diagnose remotely.
 */

import { HttpError } from "../lib/http-error";

type EnumRule = {
  kind: "enum";
  allowed: readonly string[];
};

type BooleanRule = {
  kind: "boolean";
};

type StringRule = {
  kind: "string";
  minLength?: number;
};

type ObjectRule = {
  kind: "object";
};

type FieldRule = EnumRule | BooleanRule | StringRule | ObjectRule;

/**
 * Registry of known OpenClaw config fields and their validation rules.
 * Paths use dot notation matching the JSON structure.
 *
 * Only fields that have caused real breakage (or are likely to) are listed.
 * This is intentionally not exhaustive — unknown paths are allowed through
 * with a warning rather than blocked.
 */
const KNOWN_FIELD_RULES: Record<string, FieldRule> = {
  // Sandbox
  "agents.defaults.sandbox.mode": { kind: "enum", allowed: ["off", "non-main", "all"] },
  "agents.defaults.sandbox.backend": { kind: "enum", allowed: ["docker", "ssh", "openshell"] },
  "agents.defaults.sandbox.scope": { kind: "enum", allowed: ["session", "agent", "shared"] },
  "agents.defaults.sandbox.workspaceAccess": { kind: "enum", allowed: ["none", "ro", "rw"] },

  // Memory
  "agents.defaults.compaction.memoryFlush.enabled": { kind: "boolean" },
  "agents.defaults.memorySearch.enabled": { kind: "boolean" },
  "hooks.internal.entries.session-memory.enabled": { kind: "boolean" },
  "hooks.internal.enabled": { kind: "boolean" },

  // Model
  "agents.defaults.model.primary": { kind: "string", minLength: 1 },

  // Gateway
  "gateway.mode": { kind: "enum", allowed: ["local", "cloud"] },
  "gateway.bind": { kind: "enum", allowed: ["loopback", "lan"] },
  "gateway.auth.mode": { kind: "enum", allowed: ["token", "none"] },

  // Session
  "session.dmScope": { kind: "enum", allowed: ["per-channel-peer", "global", "per-channel"] },

  // Tools
  "tools.profile": { kind: "enum", allowed: ["coding", "general", "minimal"] },

  // Commands
  "commands.native": { kind: "enum", allowed: ["auto", "on", "off"] },
  "commands.nativeSkills": { kind: "enum", allowed: ["auto", "on", "off"] },
  "commands.restart": { kind: "boolean" },
};

/**
 * Paths that must point to an object, not a scalar. Writing a scalar here
 * would break the gateway's config parser.
 */
const MUST_BE_OBJECT_PATHS = [
  "agents",
  "agents.defaults",
  "agents.defaults.sandbox",
  "agents.defaults.model",
  "agents.defaults.models",
  "channels",
  "gateway",
  "gateway.auth",
  "hooks",
  "hooks.internal",
  "hooks.internal.entries",
  "skills",
  "skills.entries",
  "plugins",
  "plugins.entries",
  "tools",
];

export type ConfigValidationIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

/**
 * Validate a single config field value before writing.
 * Returns issues found. Empty array means the value is acceptable.
 */
export function validateConfigField(path: string, value: unknown): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  // Check if this path must be an object but a scalar is being written
  if (MUST_BE_OBJECT_PATHS.includes(path)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push({
        path,
        message: `"${path}" must be an object, got ${typeof value}.`,
        severity: "error",
      });
      return issues;
    }
  }

  const rule = KNOWN_FIELD_RULES[path];
  if (!rule) {
    // Also check if a parent of this path has an agent-level variant
    // e.g. agents.list.N.sandbox.mode should follow the same enum as agents.defaults.sandbox.mode
    const agentListMatch = path.match(/^agents\.list\.\d+\.(.+)$/);
    if (agentListMatch) {
      const defaultsPath = `agents.defaults.${agentListMatch[1]}`;
      const defaultsRule = KNOWN_FIELD_RULES[defaultsPath];
      if (defaultsRule) {
        return validateWithRule(path, value, defaultsRule);
      }
    }
    return issues;
  }

  return validateWithRule(path, value, rule);
}

function validateWithRule(path: string, value: unknown, rule: FieldRule): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  switch (rule.kind) {
    case "enum": {
      if (typeof value !== "string" || !rule.allowed.includes(value)) {
        issues.push({
          path,
          message: `"${path}" must be one of: ${rule.allowed.map((v) => `"${v}"`).join(", ")}. Got: ${JSON.stringify(value)}.`,
          severity: "error",
        });
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        issues.push({
          path,
          message: `"${path}" must be a boolean. Got: ${JSON.stringify(value)}.`,
          severity: "error",
        });
      }
      break;
    }
    case "string": {
      if (typeof value !== "string") {
        issues.push({
          path,
          message: `"${path}" must be a string. Got: ${typeof value}.`,
          severity: "error",
        });
      } else if (rule.minLength !== undefined && value.trim().length < rule.minLength) {
        issues.push({
          path,
          message: `"${path}" must be at least ${rule.minLength} character(s).`,
          severity: "error",
        });
      }
      break;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        issues.push({
          path,
          message: `"${path}" must be an object. Got: ${typeof value}.`,
          severity: "error",
        });
      }
      break;
    }
  }

  return issues;
}

/**
 * Validate a config field and throw an HttpError if there are blocking issues.
 * Used as a guard before writing to openclaw.json.
 */
export function assertConfigFieldValid(path: string, value: unknown): void {
  const issues = validateConfigField(path, value);
  const errors = issues.filter((issue) => issue.severity === "error");

  if (errors.length > 0) {
    throw new HttpError(
      400,
      `Invalid config value — ${errors.map((e) => e.message).join(" ")} This would crash the OpenClaw gateway.`,
    );
  }
}

/**
 * Walk an entire config object and validate all known fields.
 * Returns all issues found. Useful for pre-flight checks before restart.
 */
export function validateConfigObject(
  config: Record<string, unknown>,
  prefix = "",
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  for (const [key, value] of Object.entries(config)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    // Check this path
    issues.push(...validateConfigField(fullPath, value));

    // Recurse into objects
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      issues.push(...validateConfigObject(value as Record<string, unknown>, fullPath));
    }

    // Recurse into arrays (for agents.list entries)
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          issues.push(...validateConfigObject(item as Record<string, unknown>, `${fullPath}.${i}`));
        }
      }
    }
  }

  return issues;
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfigField,
  assertConfigFieldValid,
  validateConfigObject,
} from "../src/services/project-config-validator";

describe("project-config-validator", () => {
  describe("validateConfigField", () => {
    it("accepts valid sandbox.mode values", () => {
      for (const value of ["off", "non-main", "all"]) {
        const issues = validateConfigField("agents.defaults.sandbox.mode", value);
        assert.equal(issues.length, 0, `expected no issues for "${value}"`);
      }
    });

    it("rejects invalid sandbox.mode values", () => {
      const issues = validateConfigField("agents.defaults.sandbox.mode", "strict");
      assert.equal(issues.length, 1);
      assert.equal(issues[0].severity, "error");
      assert.ok(issues[0].message.includes('"strict"'));
    });

    it("rejects non-string sandbox.mode", () => {
      const issues = validateConfigField("agents.defaults.sandbox.mode", 42);
      assert.equal(issues.length, 1);
      assert.equal(issues[0].severity, "error");
    });

    it("accepts valid sandbox.backend values", () => {
      for (const value of ["docker", "ssh", "openshell"]) {
        const issues = validateConfigField("agents.defaults.sandbox.backend", value);
        assert.equal(issues.length, 0);
      }
    });

    it("rejects invalid sandbox.backend", () => {
      const issues = validateConfigField("agents.defaults.sandbox.backend", "podman");
      assert.equal(issues.length, 1);
      assert.equal(issues[0].severity, "error");
    });

    it("accepts valid boolean fields", () => {
      const issues = validateConfigField("hooks.internal.enabled", true);
      assert.equal(issues.length, 0);
    });

    it("rejects non-boolean for boolean fields", () => {
      const issues = validateConfigField("hooks.internal.enabled", "yes");
      assert.equal(issues.length, 1);
      assert.equal(issues[0].severity, "error");
    });

    it("allows unknown paths through without issues", () => {
      const issues = validateConfigField("some.unknown.path", "anything");
      assert.equal(issues.length, 0);
    });

    it("rejects scalar values for must-be-object paths", () => {
      const issues = validateConfigField("agents", "not-an-object");
      assert.equal(issues.length, 1);
      assert.equal(issues[0].severity, "error");
      assert.ok(issues[0].message.includes("must be an object"));
    });

    it("validates agents.list.N.sandbox.mode via agent-level pattern", () => {
      const issues = validateConfigField("agents.list.1.sandbox.mode", "strict");
      assert.equal(issues.length, 1);
      assert.equal(issues[0].severity, "error");
      assert.ok(issues[0].message.includes('"strict"'));
    });

    it("accepts valid agents.list.N.sandbox.mode", () => {
      const issues = validateConfigField("agents.list.1.sandbox.mode", "all");
      assert.equal(issues.length, 0);
    });
  });

  describe("assertConfigFieldValid", () => {
    it("does not throw for valid values", () => {
      assert.doesNotThrow(() => {
        assertConfigFieldValid("agents.defaults.sandbox.mode", "off");
      });
    });

    it("throws HttpError for invalid values", () => {
      assert.throws(
        () => {
          assertConfigFieldValid("agents.defaults.sandbox.mode", "strict");
        },
        (error: Error) => {
          assert.ok(error.message.includes("crash"));
          return true;
        },
      );
    });
  });

  describe("validateConfigObject", () => {
    it("finds errors in a nested config", () => {
      const config = {
        agents: {
          defaults: {
            sandbox: {
              mode: "strict",
              backend: "docker",
            },
          },
          list: [
            { id: "main" },
            {
              id: "broken",
              sandbox: { mode: "invalid-value" },
            },
          ],
        },
      };

      const issues = validateConfigObject(config);
      const errors = issues.filter((i) => i.severity === "error");
      assert.ok(errors.length >= 1, `expected at least 1 error, got ${errors.length}`);

      const sandboxError = errors.find((e) => e.path === "agents.defaults.sandbox.mode");
      assert.ok(sandboxError, "expected error for agents.defaults.sandbox.mode");
    });

    it("returns empty for a valid config", () => {
      const config = {
        agents: {
          defaults: {
            sandbox: {
              mode: "off",
              backend: "docker",
              scope: "agent",
              workspaceAccess: "none",
            },
          },
        },
        gateway: {
          mode: "local",
          bind: "loopback",
        },
      };

      const issues = validateConfigObject(config);
      const errors = issues.filter((i) => i.severity === "error");
      assert.equal(errors.length, 0);
    });
  });
});

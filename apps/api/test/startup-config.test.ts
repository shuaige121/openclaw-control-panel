import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HOST,
  assertSafeManagerBinding,
  isLoopbackHost,
  resolveHost,
  resolvePort,
} from "../src/lib/startup-config";

test("resolveHost defaults to loopback", () => {
  assert.equal(resolveHost(undefined), DEFAULT_HOST);
  assert.equal(resolveHost("   "), DEFAULT_HOST);
  assert.equal(resolveHost("0.0.0.0"), "0.0.0.0");
});

test("isLoopbackHost accepts localhost, IPv4 loopback, and IPv6 loopback", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.0.42"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("192.168.7.200"), false);
});

test("non-loopback binds require an allowlist or explicit override", () => {
  assert.throws(
    () => assertSafeManagerBinding({ host: "0.0.0.0", allowedIps: [] }),
    /MANAGER_ALLOWED_IPS/,
  );

  assert.doesNotThrow(() =>
    assertSafeManagerBinding({
      host: "0.0.0.0",
      allowedIps: ["127.0.0.1", "192.168.7.0/24"],
    }),
  );

  assert.doesNotThrow(() =>
    assertSafeManagerBinding({
      host: "10.0.0.5",
      allowedIps: [],
      allowUnsafeBind: true,
    }),
  );
});

test("resolvePort preserves existing validation", () => {
  assert.equal(resolvePort(undefined), 3000);
  assert.equal(resolvePort("3001"), 3001);
  assert.throws(() => resolvePort("0"), /Invalid PORT value/);
});

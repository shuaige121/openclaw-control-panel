const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = "127.0.0.1";

type SafeManagerBindingOptions = {
  host: string;
  allowedIps: string[];
  allowUnsafeBind?: boolean;
};

function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function isIpv4Loopback(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 127;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);

  return normalized === "localhost" || normalized === "::1" || isIpv4Loopback(normalized);
}

export function resolvePort(rawPort: string | undefined): number {
  if (rawPort === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(rawPort, 10);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return port;
}

export function resolveHost(rawHost: string | undefined): string {
  if (rawHost === undefined || rawHost.trim().length === 0) {
    return DEFAULT_HOST;
  }

  return rawHost.trim();
}

export function assertSafeManagerBinding(options: SafeManagerBindingOptions): void {
  if (options.allowUnsafeBind || isLoopbackHost(options.host) || options.allowedIps.length > 0) {
    return;
  }

  throw new Error(
    `Refusing to bind OpenClaw Manager to ${options.host} without MANAGER_ALLOWED_IPS. ` +
      `Set MANAGER_ALLOWED_IPS, use HOST=${DEFAULT_HOST}, or set MANAGER_ALLOW_UNSAFE_BIND=1 ` +
      `if you intentionally accept the risk.`,
  );
}

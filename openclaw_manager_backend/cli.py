from __future__ import annotations

import argparse
import errno
import fcntl
import json
import os
import shutil
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Any

BASE_PORT = 18800
DEFAULT_MODEL = "anthropic/claude-sonnet-4-6"
DEFAULT_TIMEOUT_SECONDS = 20
PORT_LOCK_PATH = Path("/tmp/openclaw-manager-port.lock")
DEFAULT_AUTH_PROFILES = {
    "version": 1,
    "profiles": {},
}


class CliError(Exception):
    pass


def sanitize_profile_name(profile_name: str) -> str:
    sanitized = (
        profile_name.strip().lower().replace(" ", "-")
    )
    sanitized = "".join(char for char in sanitized if char.isalnum() or char == "-")
    while "--" in sanitized:
        sanitized = sanitized.replace("--", "-")
    sanitized = sanitized.strip("-")

    if not sanitized:
        raise CliError(
            "profileName must contain at least one alphanumeric character after sanitization."
        )

    return sanitized


def require_display_name(display_name: str) -> str:
    normalized = display_name.strip()
    if not normalized:
        raise CliError("displayName must be a non-empty string.")
    return normalized


def normalize_model(model: str | None) -> str:
    normalized = (model or "").strip()
    return normalized or DEFAULT_MODEL


def normalize_tags(tags: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for tag in tags:
        cleaned = tag.strip()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            normalized.append(cleaned)
    return normalized


def parse_channel_credentials(entries: list[str]) -> dict[str, str]:
    credentials: dict[str, str] = {}
    for entry in entries:
        if "=" not in entry:
            raise CliError(
                f'Invalid channel credential "{entry}". Expected KEY=VALUE.'
            )
        key, value = entry.split("=", 1)
        key = key.strip()
        if not key:
            raise CliError("Channel credential key must be non-empty.")
        credentials[key] = value
    return credentials


def require_channel_credential(
    credentials: dict[str, str], field_name: str, channel_type: str
) -> str:
    value = credentials.get(field_name, "").strip()
    if not value:
        raise CliError(f"{field_name} must be provided for {channel_type} channels.")
    return value


def build_channel_config(
    channel_type: str,
    credentials: dict[str, str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    if channel_type == "telegram":
        return (
            {
                "telegram": {
                    "enabled": True,
                    "botToken": require_channel_credential(
                        credentials, "botToken", "telegram"
                    ),
                    "dmPolicy": "open",
                }
            },
            {},
        )

    if channel_type == "wecom":
        return (
            {
                "wecom": {
                    "enabled": True,
                    "botId": require_channel_credential(credentials, "botId", "wecom"),
                    "secret": require_channel_credential(
                        credentials, "secret", "wecom"
                    ),
                    "dmPolicy": "open",
                    "groupPolicy": "disabled",
                    "allowFrom": ["*"],
                }
            },
            {
                "wecom-openclaw-plugin": {
                    "enabled": True,
                }
            },
        )

    if channel_type == "feishu":
        return (
            {
                "feishu": {
                    "enabled": True,
                    "domain": "feishu",
                    "accounts": {
                        "main": {
                            "appId": require_channel_credential(
                                credentials, "appId", "feishu"
                            ),
                            "appSecret": require_channel_credential(
                                credentials, "appSecret", "feishu"
                            ),
                        }
                    },
                }
            },
            {},
        )

    if channel_type == "whatsapp":
        return (
            {
                "whatsapp": {
                    "enabled": True,
                    "dmPolicy": "pairing",
                }
            },
            {},
        )

    return ({}, {})


def can_bind_port(host: str, port: int, family: socket.AddressFamily) -> bool:
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        if family == socket.AF_INET6:
            try:
                sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            except (AttributeError, OSError):
                pass

        try:
            sock.bind((host, port))
        except OSError as error:
            if family == socket.AF_INET6 and error.errno in {
                errno.EADDRNOTAVAIL,
                errno.EAFNOSUPPORT,
                errno.EPROTONOSUPPORT,
            }:
                return True
            return False
    return True


def is_port_free(port: int) -> bool:
    bind_checks: list[tuple[str, socket.AddressFamily]] = [
        ("127.0.0.1", socket.AF_INET),
        ("0.0.0.0", socket.AF_INET),
    ]
    if socket.has_ipv6:
        bind_checks.extend(
            [
                ("::1", socket.AF_INET6),
                ("::", socket.AF_INET6),
            ]
        )

    for host, family in bind_checks:
        if not can_bind_port(host, port, family):
            return False
    return True


def allocate_port(existing_ports: list[int], requested_port: int | None) -> int:
    used_ports = set(existing_ports)

    if requested_port is not None:
        if requested_port < 1 or requested_port > 65535:
            raise CliError("port must be an integer between 1 and 65535.")
        if requested_port in used_ports:
            raise CliError(f"Port {requested_port} is already allocated in the registry.")
        if not is_port_free(requested_port):
            raise CliError(f"Port {requested_port} is already in use on this machine.")
        return requested_port

    port = BASE_PORT
    while port <= 65535:
        if port not in used_ports and is_port_free(port):
            return port
        port += 1

    raise CliError("No free gateway ports were found.")


@contextmanager
def port_allocation_lock():
    PORT_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with PORT_LOCK_PATH.open("a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def discover_provisioned_ports(home_dir: Path) -> list[int]:
    ports: list[int] = []
    for config_path in home_dir.glob(".openclaw-*/openclaw.json"):
        try:
            payload = json.loads(config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        if not isinstance(payload, dict):
            continue

        gateway = payload.get("gateway")
        if not isinstance(gateway, dict):
            continue

        port = gateway.get("port")
        if isinstance(port, int) and not isinstance(port, bool) and 1 <= port <= 65535:
            ports.append(port)

    return ports


def build_openclaw_config(
    *,
    profile_name: str,
    display_name: str,
    description: str | None,
    model: str | None,
    port: int,
    channel_type: str,
    channel_credentials: dict[str, str],
    sandbox_mode: str,
    tags: list[str],
    workspace_path: Path,
) -> dict[str, Any]:
    channels, plugin_entries = build_channel_config(channel_type, channel_credentials)
    config: dict[str, Any] = {
        "agents": {
            "defaults": {
                "model": {
                    "primary": normalize_model(model),
                },
                "workspace": str(workspace_path),
                "heartbeat": {
                    "every": "0m",
                },
            },
            "list": [
                {
                    "id": "main",
                    "default": True,
                    "name": display_name,
                    "identity": {
                        "name": display_name,
                        "emoji": "🤖",
                    },
                    "sandbox": {
                        "mode": sandbox_mode,
                    },
                }
            ],
        },
        "gateway": {
            "port": port,
            "bind": "loopback",
        },
        "channels": channels,
        "plugins": {
            "entries": plugin_entries,
        },
    }

    manager_meta: dict[str, Any] = {
        "profileName": profile_name,
    }
    if description:
        manager_meta["description"] = description
    normalized_tags = normalize_tags(tags)
    if normalized_tags:
        manager_meta["tags"] = normalized_tags

    config["meta"] = {
        "openclawManager": manager_meta,
    }
    strip_unsupported_openclaw_keys(config)
    return config


def strip_unsupported_openclaw_keys(config: dict[str, Any]) -> None:
    commands = config.get("commands")
    if isinstance(commands, dict):
        commands.pop("ownerDisplay", None)
        if not commands:
            config.pop("commands", None)

    channels = config.get("channels")
    if isinstance(channels, dict):
        telegram = channels.get("telegram")
        if isinstance(telegram, dict):
            telegram.pop("streaming", None)

    meta = config.get("meta")
    if isinstance(meta, dict):
        meta.pop("openclawManager", None)
        if not meta:
            config.pop("meta", None)


def clear_destination_path(destination: Path) -> None:
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink():
            destination.unlink()
        elif destination.is_file():
            destination.unlink()
        elif destination.is_dir():
            shutil.rmtree(destination)


def ensure_symlink_or_copy(source: Path, destination: Path, mode: str) -> str:
    if not source.exists():
        raise CliError(f"Required source path was not found: {source}")

    destination.parent.mkdir(parents=True, exist_ok=True)

    if destination.is_symlink():
        existing_target = destination.resolve(strict=False)
        if existing_target == source.resolve():
            return "symlink"

    clear_destination_path(destination)

    if mode == "copy":
        if source.is_dir():
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)
        return "copy"

    try:
        os.symlink(source, destination, target_is_directory=source.is_dir())
        return "symlink"
    except OSError as error:
        if source.is_dir():
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)
        return f"copy-fallback:{error.__class__.__name__}"


def copy_or_initialize_auth_profiles(
    source_paths: list[Path],
    destination: Path,
) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    clear_destination_path(destination)

    for source in source_paths:
        if not source.exists() or not source.is_file():
            continue
        shutil.copy2(source, destination)
        return "copy"

    destination.write_text(
        f"{json.dumps(DEFAULT_AUTH_PROFILES, indent=2)}\n",
        encoding="utf-8",
    )
    return "initialized"


def resolve_openclaw_install_dir(home_dir: Path) -> Path:
    """Resolve the OpenClaw installation directory (contains openclaw.mjs).

    Search order:
      1. ~/.npm-global/lib/node_modules/openclaw (npm global install)
      2. ~/openclaw (local/dev install)
      3. Fall back to state_dir (caller must handle missing openclaw.mjs)
    """
    candidates = [
        home_dir / ".npm-global" / "lib" / "node_modules" / "openclaw",
        home_dir / "openclaw",
    ]
    for candidate in candidates:
        if (candidate / "openclaw.mjs").exists():
            return candidate
    return None


def provision_instance(args: argparse.Namespace) -> dict[str, Any]:
    profile_name = sanitize_profile_name(args.profile_name)
    display_name = require_display_name(args.display_name)
    description = args.description.strip() if args.description else None
    tags = normalize_tags(args.tag)
    requested_port = args.port
    channel_credentials = parse_channel_credentials(args.channel_credential)
    home_dir = Path(args.home_dir).expanduser().resolve()
    shared_state_dir = home_dir / ".openclaw"
    state_dir = home_dir / f".openclaw-{profile_name}"
    config_path = state_dir / "openclaw.json"
    workspace_path = shared_state_dir / f"workspace-{profile_name}"
    workspace_memory_dir = workspace_path / "memory"
    workspace_memory_file = workspace_path / "MEMORY.md"
    agent_dir = state_dir / "agents" / "main" / "agent"
    sessions_dir = state_dir / "agents" / "main" / "sessions"
    shared_agent_dir = shared_state_dir / "agents" / "main" / "agent"
    shared_extensions_dir = shared_state_dir / "extensions"
    extensions_dir = state_dir / "extensions"

    shared_auth_path = shared_agent_dir / "auth-profiles.json"
    shared_root_auth_path = shared_state_dir / "auth-profiles.json"
    shared_models_path = shared_agent_dir / "models.json"
    instance_auth_path = agent_dir / "auth-profiles.json"
    instance_models_path = agent_dir / "models.json"

    with port_allocation_lock():
        allocated_ports = list(args.existing_port)
        allocated_ports.extend(discover_provisioned_ports(home_dir))
        port = allocate_port(allocated_ports, requested_port)

        config = build_openclaw_config(
            profile_name=profile_name,
            display_name=display_name,
            description=description,
            model=args.model,
            port=port,
            channel_type=args.channel_type,
            channel_credentials=channel_credentials,
            sandbox_mode=args.sandbox_mode,
            tags=tags,
            workspace_path=workspace_path,
        )

        state_dir.mkdir(parents=True, exist_ok=True)
        shared_extensions_dir.mkdir(parents=True, exist_ok=True)
        workspace_path.mkdir(parents=True, exist_ok=True)
        workspace_memory_dir.mkdir(parents=True, exist_ok=True)
        if not workspace_memory_file.exists():
            workspace_memory_file.write_text("", encoding="utf-8")
        agent_dir.mkdir(parents=True, exist_ok=True)
        sessions_dir.mkdir(parents=True, exist_ok=True)
        config_path.write_text(f"{json.dumps(config, indent=2)}\n", encoding="utf-8")
        (sessions_dir / "sessions.json").write_text(
            '{"version":1,"items":[]}\n', encoding="utf-8"
        )

        auth_link_mode = copy_or_initialize_auth_profiles(
            [shared_auth_path, shared_root_auth_path],
            instance_auth_path,
        )
        models_link_mode = ensure_symlink_or_copy(
            shared_models_path, instance_models_path, args.auth_link_mode
        )
        extensions_link_mode = ensure_symlink_or_copy(
            shared_extensions_dir, extensions_dir, "symlink"
        )

    return {
        "profileName": profile_name,
        "port": port,
        "rootPath": str(resolve_openclaw_install_dir(home_dir) or state_dir),
        "configPath": str(config_path),
        "workspacePath": str(workspace_path),
        "stateDirPath": str(state_dir),
        "authLinkMode": auth_link_mode,
        "modelsLinkMode": models_link_mode,
        "extensionsLinkMode": extensions_link_mode,
    }


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    data = None
    headers = {
        "Accept": "application/json",
    }

    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, method=method, headers=headers)

    try:
        with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        try:
            parsed = json.loads(body)
            message = parsed.get("error", {}).get("message") or body
        except json.JSONDecodeError:
            message = body or str(error)
        raise CliError(f"{method} {url} failed: {message}") from error
    except urllib.error.URLError as error:
        raise CliError(f"{method} {url} failed: {error.reason}") from error


def normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


def api_list(args: argparse.Namespace) -> Any:
    return request_json("GET", f"{normalize_base_url(args.base_url)}/api/projects")


def api_action(args: argparse.Namespace) -> Any:
    return request_json(
        "POST",
        f"{normalize_base_url(args.base_url)}/api/projects/{urllib.parse.quote(args.project_id)}/actions/{urllib.parse.quote(args.action)}",
    )


def api_create(args: argparse.Namespace) -> Any:
    payload: dict[str, Any] = {
        "createInstance": True,
        "id": args.project_id,
        "name": args.name or args.project_id,
        "description": args.description or "",
        "gateway": {
            "protocol": args.protocol,
            "host": args.host,
        },
        "auth": {
            "mode": "inherit_manager",
        },
        "lifecycle": {
            "mode": "managed_openclaw",
            "bind": args.bind,
            "allowUnconfigured": True,
            "startupTimeoutMs": args.startup_timeout_ms,
        },
        "capabilities": {
            "bulkHooks": True,
            "bulkSkills": True,
            "bulkMemory": True,
            "bulkConfigPatch": True,
        },
        "tags": args.tag,
        "templateId": args.template_id,
        "applyTemplateAfterCreate": args.apply_template,
    }

    if args.port is not None:
        payload["gateway"]["port"] = args.port
    if args.model:
        payload["model"] = args.model
    if args.channel_type:
        payload["channelType"] = args.channel_type
    if args.sandbox_mode:
        payload["sandboxMode"] = args.sandbox_mode
    if args.channel_credential:
        payload["channelCredentials"] = parse_channel_credentials(args.channel_credential)

    return request_json(
        "POST",
        f"{normalize_base_url(args.base_url)}/api/projects",
        payload,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="openclaw-manager-backend",
        description="Provision and control OpenClaw Manager projects.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    provision_parser = subparsers.add_parser(
        "provision",
        help="Provision a new OpenClaw profile on disk.",
    )
    provision_parser.add_argument("--home-dir", required=True)
    provision_parser.add_argument("--profile-name", required=True)
    provision_parser.add_argument("--display-name", required=True)
    provision_parser.add_argument("--description")
    provision_parser.add_argument("--model")
    provision_parser.add_argument("--port", type=int)
    provision_parser.add_argument(
        "--channel-type",
        choices=["none", "telegram", "wecom", "feishu", "whatsapp"],
        default="none",
    )
    provision_parser.add_argument(
        "--channel-credential",
        action="append",
        default=[],
        metavar="KEY=VALUE",
    )
    provision_parser.add_argument(
        "--sandbox-mode",
        choices=["off", "all"],
        default="off",
    )
    provision_parser.add_argument("--tag", action="append", default=[])
    provision_parser.add_argument("--existing-port", action="append", default=[], type=int)
    provision_parser.add_argument(
        "--auth-link-mode",
        choices=["symlink", "copy"],
        default="symlink",
    )

    api_parser = subparsers.add_parser(
        "api",
        help="Control the manager API from the terminal.",
    )
    api_subparsers = api_parser.add_subparsers(dest="api_command", required=True)

    list_parser = api_subparsers.add_parser("list", help="List projects from the manager API.")
    list_parser.add_argument("--base-url", default="http://127.0.0.1:3000")

    action_parser = api_subparsers.add_parser("action", help="Run start/stop/restart for a project.")
    action_parser.add_argument("project_id")
    action_parser.add_argument("action", choices=["start", "stop", "restart"])
    action_parser.add_argument("--base-url", default="http://127.0.0.1:3000")

    create_parser = api_subparsers.add_parser("create", help="Provision and register a new project through the manager API.")
    create_parser.add_argument("project_id")
    create_parser.add_argument("--name")
    create_parser.add_argument("--description")
    create_parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    create_parser.add_argument("--protocol", choices=["http", "https"], default="http")
    create_parser.add_argument("--host", default="127.0.0.1")
    create_parser.add_argument("--port", type=int)
    create_parser.add_argument("--model")
    create_parser.add_argument("--bind", choices=["loopback", "lan"], default="loopback")
    create_parser.add_argument("--startup-timeout-ms", type=int, default=15000)
    create_parser.add_argument("--tag", action="append", default=[])
    create_parser.add_argument(
        "--template-id",
        choices=[
            "general",
            "stateless",
            "sandboxed",
            "ultramarines",
            "sisters-of-silence",
            "iron-hands",
            "blood-angels",
            "dark-angels",
        ],
        default="general",
    )
    create_parser.add_argument(
        "--channel-type",
        choices=["none", "telegram", "wecom", "feishu", "whatsapp"],
        default="none",
    )
    create_parser.add_argument(
        "--channel-credential",
        action="append",
        default=[],
        metavar="KEY=VALUE",
    )
    create_parser.add_argument(
        "--sandbox-mode",
        choices=["off", "all"],
        default=None,
    )
    create_parser.add_argument(
        "--apply-template",
        action=argparse.BooleanOptionalAction,
        default=True,
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "provision":
            result = provision_instance(args)
        elif args.command == "api" and args.api_command == "list":
            result = api_list(args)
        elif args.command == "api" and args.api_command == "action":
            result = api_action(args)
        elif args.command == "api" and args.api_command == "create":
            result = api_create(args)
        else:
            parser.error("Unknown command.")
            return 2
    except CliError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

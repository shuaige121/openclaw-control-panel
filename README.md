<div align="center">

<img src="assets/banner.svg" alt="OpenClaw Control Panel" width="100%"/>

<br/>

[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/API-Express-000000?style=flat-square&logo=express)](https://expressjs.com/)
[![React](https://img.shields.io/badge/UI-React_18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

</div>

---

## Philosophy

There is a recurring temptation in software: **make the one thing do everything.**

One bot. One context. One massive prompt carrying the weight of ops, coding, research, customer service, experiments, and whatever you bolted on last Tuesday. It works — until it doesn't. The context window fills with irrelevant baggage. Tools meant for one task bleed into another. The bot becomes a bureaucrat: aware of everything, good at nothing.

This is not a new problem. Unix solved it forty years ago.

> *Do one thing and do it well.* — Doug McIlroy, 1978

OpenClaw Control Panel applies this principle to AI agents.

Instead of one overloaded bot, you run many. Each [OpenClaw](https://github.com/openclaw/openclaw) instance carries one responsibility, one tool surface, one slice of reality. **The control panel does not unify them. It keeps them apart — observable, operable, and sovereign.**

## The Worldline Model

We borrow a term from physics.

A **worldline** is the path a particle traces through spacetime — unique, continuous, non-intersecting. In the same way, each OpenClaw project traces its own path: its own memory, its own tools, its own model, its own conversation history.

<div align="center">
<br/>
<img src="assets/architecture.svg" alt="Architecture" width="100%"/>
<br/><br/>
</div>

Worldlines do not merge. That is the point.

When you want to experiment, you don't add an `if` branch to your production bot. You spin up a new worldline. When the experiment fails, nothing else is contaminated. When it succeeds, it's already isolated and ready to promote.

The control panel watches the worldlines. It does not live inside them.

## Capabilities

<table>
<tr>
<td width="50%">

**$\color{#58a6ff}{\textsf{See}}$** — Live Health Probes

TCP + `/healthz` + `/readyz` across all projects. Runtime truth beats database truth.

</td>
<td width="50%">

**$\color{#7ee787}{\textsf{Act}}$** — Lifecycle Control

Start, stop, restart any worldline. One dashboard, many organisms.

</td>
</tr>
<tr>
<td>

**$\color{#d2a8ff}{\textsf{Change}}$** — Bulk Operations

Push hooks, skills, memory patches, config changes across projects at scale.

</td>
<td>

**$\color{#f0883e}{\textsf{Tune}}$** — Model Switching

Change the default model per project with optional auto-restart.

</td>
</tr>
<tr>
<td>

**$\color{#79c0ff}{\textsf{Enter}}$** — Deep Links

Jump into each project's native OpenClaw Control UI for single-instance work.

</td>
<td>

**$\color{#ff7b72}{\textsf{Remote}}$** — Telegram Bot

`/projects` `/status` `/start` `/stop` `/restart` — operate from anywhere.

</td>
</tr>
</table>

## Quick Start

```bash
git clone https://github.com/shuaige121/openclaw-control-panel.git
cd openclaw-control-panel
npm install
npm run dev
```

> [!TIP]
> **API** → `http://localhost:3000` &nbsp;&nbsp;|&nbsp;&nbsp; **Dashboard** → `http://localhost:5173`
>
> After `npm run build`, the API serves the dashboard on port 3000.

## Configuration

<details>
<summary>&nbsp;🔒&nbsp; <b>Access Control</b> — who can observe the worldlines</summary>
<br/>

```bash
MANAGER_ALLOWED_IPS=127.0.0.1,::1,192.168.7.0/24
MANAGER_TRUST_PROXY=1  # behind a reverse proxy
```

Supports exact IPs and IPv4 CIDR notation.

</details>

<details>
<summary>&nbsp;🤖&nbsp; <b>Telegram Bot</b> — remote observation and control</summary>
<br/>

```bash
MANAGER_TELEGRAM_BOT_TOKEN=123456:token
MANAGER_TELEGRAM_ALLOWED_USER_IDS=7624953278
```

Commands: `/projects` `/status <id>` `/start <id>` `/stop <id>` `/restart <id>` `/scan <id>`

</details>

<details>
<summary>&nbsp;💾&nbsp; <b>Runtime Data</b> — the control panel's own memory</summary>
<br/>

Registry and action history live in `data/` (gitignored). Pre-seed from examples:

```bash
cp data/projects.example.json data/projects.json
cp data/action-history.example.json data/action-history.json
```

Files are auto-created on first write if missing.

</details>

<details>
<summary>&nbsp;🚀&nbsp; <b>Lifecycle Modes</b> — how each worldline boots</summary>
<br/>

Each project can use one of two runtime models:

- `managed_openclaw`
  Control Panel launches `gateway run` directly, keeps a pid/log under `data/runtime/`, and probes until the gateway is really up.
- `custom_commands`
  Control Panel delegates start/stop/restart to your existing PM2, systemd, or shell workflow.

Use `managed_openclaw` for new isolated projects. Keep `custom_commands` for legacy deployments you already trust.

</details>

## Development

Requires **Node.js >= 22**.

```bash
npm run dev         # concurrent API + Vite dev server
npm run typecheck   # type check both workspaces
npm run test        # API tests
npm run build       # production build
```

## On Simplicity

> *Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.*
>
> — Antoine de Saint-Exupéry

The control panel is intentionally thin. It does not aspire to become the thing it manages. It holds the registry, probes the health, executes the commands, and gets out of the way.

The depth belongs to each worldline. The breadth belongs to the control panel.

Mixing them is how software dies.

---

<div align="center">

**MIT License**

*Separate the concerns. Observe the worldlines. Keep it simple.*

</div>

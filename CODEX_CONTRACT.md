# Fix Contract for openclaw-manager

You are working in /home/leonard/openclaw-manager. All changes are uncommitted from a recent provisioning update. Your job is to fix the following bugs and issues. Do NOT change unrelated code. Do NOT commit.

## P0 — Must Fix

### 1. No filesystem rollback on partial instance creation failure
- File: apps/api/src/routes/projects.ts (POST / handler where createInstance is true)
- Problem: createInstance() writes dirs/config/symlinks to disk. If registryService.createProject() fails afterward, orphaned files remain.
- Fix: Wrap the registry write in try/catch. On failure, clean up instance.stateDirPath and instance.workspacePath. Log the cleanup.

### 2. Port allocation TOCTOU race on concurrent creates
- File: openclaw_manager_backend/cli.py, allocate_port()
- Problem: Two concurrent creates can get the same port because the registry has not been written yet when the second request checks.
- Fix: Add a file lock (fcntl.flock or a lockfile) around port allocation in the Python provisioner. Use a lock file at /tmp/openclaw-manager-port.lock.

## P1 — Should Fix

### 3. Insufficient request body validation for createInstance
- File: apps/api/src/routes/projects.ts
- Problem: body.auth and body.lifecycle only get an isObject check before being stored. Arbitrary fields can be injected.
- Fix: When createInstance is true, force auth to { mode: "inherit_manager" } and build lifecycle from validated fields only.

### 4. Python port check is IPv4 only
- File: openclaw_manager_backend/cli.py, is_port_free()
- Problem: Only checks 127.0.0.1 and 0.0.0.0. Misses IPv6.
- Fix: Add IPv6 checks for ::1 and :: using socket.AF_INET6.

## P2 — Nice to Have

### 5. Config file read-modify-write has no locking
- File: apps/api/src/services/project-channels.ts, updateChannel()
- Fix: Use a per-project lock around the read-modify-write cycle, similar to writeChain in project-registry.ts.

### 6. ecosystem.config.js should not be committed
- Fix: Add ecosystem.config.js to .gitignore.

## Validation
After changes run: npm run typecheck, npm test, npm run build. All must pass.

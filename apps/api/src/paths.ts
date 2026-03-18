import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const PROJECTS_REGISTRY_PATH = path.join(DATA_DIR, "projects.json");
export const ACTION_HISTORY_PATH = path.join(DATA_DIR, "action-history.json");
export const MANAGER_TELEGRAM_STATE_PATH = path.join(DATA_DIR, "manager-telegram-state.json");
export const PROJECT_RUNTIME_DIR = path.join(DATA_DIR, "runtime");
export const WEB_DIST_DIR = path.join(REPO_ROOT, "apps", "web", "dist");

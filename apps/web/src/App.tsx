import { ActionHistoryPanel } from "./components/action-history-panel";
import { useEffect, useMemo, useState } from "react";
import { BulkActionPanel } from "./components/bulk-action-panel";
import { BulkToolbar } from "./components/bulk-toolbar";
import { ProjectEditor } from "./components/project-editor";
import { ProjectCard } from "./components/project-card";
import { useTheme } from "./theme";
import type {
  ActionHistoryResponse,
  BulkActionExecutePayload,
  BulkActionResponse,
  BulkIntent,
  ProjectDetailResponse,
  ProjectActionName,
  ProjectActionResponse,
  ProjectCompatibilityScanResponse,
  ProjectMemoryModeUpdateResponse,
  ProjectModelUpdateResponse,
  ProjectSmokeTestResponse,
  ProjectTemplateApplyResponse,
  ProjectTemplateDefinition,
  ProjectTemplateId,
  ProjectTemplateListResponse,
  ProjectUpsertPayload,
  ProjectsResponse,
} from "./types";

type PanelMode = "detail" | "create" | "edit";
type MutationState = "idle" | "saving" | "deleting" | "bulk";
type Notice = {
  tone: "success" | "error";
  text: string;
};

function getErrorMessage(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }

  return null;
}

async function requestApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new Error(getErrorMessage(body) ?? `${response.status} ${response.statusText}`);
  }

  return body as T;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "请求失败，请稍后再试。";
}

export default function App() {
  const [data, setData] = useState<ProjectsResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<ActionHistoryResponse | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplateDefinition[]>([]);
  const [search, setSearch] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bulkIntent, setBulkIntent] = useState<BulkIntent | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("detail");
  const [editorStatus, setEditorStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [editorProject, setEditorProject] = useState<ProjectDetailResponse["registry"] | null>(null);
  const [editorErrorMessage, setEditorErrorMessage] = useState<string | null>(null);
  const [mutationState, setMutationState] = useState<MutationState>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [bulkErrorMessage, setBulkErrorMessage] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkActionResponse | null>(null);
  const [activeProjectAction, setActiveProjectAction] = useState<ProjectActionName | null>(null);
  const [compatibilityScanProjectId, setCompatibilityScanProjectId] = useState<string | null>(null);
  const [modelUpdateProjectId, setModelUpdateProjectId] = useState<string | null>(null);
  const [memoryUpdateProjectId, setMemoryUpdateProjectId] = useState<string | null>(null);
  const [templateApplyProjectId, setTemplateApplyProjectId] = useState<string | null>(null);
  const [catalogActionKey, setCatalogActionKey] = useState<string | null>(null);
  const [smokeTestProjectId, setSmokeTestProjectId] = useState<string | null>(null);
  const [smokeTestResult, setSmokeTestResult] = useState<ProjectSmokeTestResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProjectsWithTemplates() {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const [payload, templateCatalog, history] = await Promise.all([
          requestApi<ProjectsResponse>("/api/projects", {
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          }),
          requestApi<ProjectTemplateListResponse>("/api/projects/templates", {
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          }).catch(() => ({
            items: [],
            generatedAt: new Date().toISOString(),
          })),
          requestApi<ActionHistoryResponse>("/api/actions?limit=40", {
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          }).catch(() => null),
        ]);

        setData(payload);
        setTemplates(templateCatalog.items);
        setHistoryData(history);
        setStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setStatus("error");
        setErrorMessage(toErrorMessage(error));
      }
    }

    void loadProjectsWithTemplates();

    return () => {
      controller.abort();
    };
  }, [reloadToken]);

  const items = data?.items ?? [];

  const filteredProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return items;
    }

    return items.filter((project) => {
      const haystacks = [
        project.name,
        project.description,
        project.paths.rootPath,
        project.paths.workspacePath,
        project.paths.configPath,
        project.auth.label,
        project.tags.join(" "),
      ];

      return haystacks.some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [items, search]);

  useEffect(() => {
    if (activeId === null) {
      return;
    }

    const activeStillExists = filteredProjects.some((project) => project.id === activeId);
    if (!activeStillExists) {
      setActiveId(null);
    }
  }, [activeId, filteredProjects]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => items.some((project) => project.id === id)));
  }, [items]);

  useEffect(() => {
    if (selectedIds.length === 0) {
      setBulkIntent(null);
      setBulkErrorMessage(null);
      setBulkResult(null);
    }
  }, [selectedIds.length]);

  const selectedProjects = useMemo(
    () => items.filter((project) => selectedIds.includes(project.id)),
    [items, selectedIds],
  );
  const expandedProject = filteredProjects.find((project) => project.id === activeId) ?? null;
  const visibleHistoryItems = useMemo(() => {
    const items = historyData?.items ?? [];
    if (!expandedProject) {
      return items.slice(0, 8);
    }

    return items
      .filter((entry) => entry.projects.some((project) => project.id === expandedProject.id))
      .slice(0, 6);
  }, [expandedProject, historyData]);

  function toggleExpandProject(projectId: string) {
    setActiveId((current) => (current === projectId ? null : projectId));
  }

  function toggleProjectSelection(projectId: string) {
    setSelectedIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  }

  function selectAllFiltered() {
    setSelectedIds(filteredProjects.map((project) => project.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function reloadProjects(nextActiveId?: string | null) {
    if (nextActiveId !== undefined) {
      setActiveId(nextActiveId);
    }
    setReloadToken((value) => value + 1);
  }

  function openCreatePanel() {
    setPanelMode("create");
    setEditorStatus("ready");
    setEditorProject(null);
    setEditorErrorMessage(null);
    setBulkIntent(null);
  }

  async function openEditPanel(projectId: string) {
    setPanelMode("edit");
    setEditorStatus("loading");
    setEditorProject(null);
    setEditorErrorMessage(null);
    setNotice(null);
    setBulkIntent(null);

    try {
      const detail = await requestApi<ProjectDetailResponse>(`/api/projects/${projectId}`, {
        headers: {
          Accept: "application/json",
        },
      });
      setEditorProject(detail.registry);
      setEditorStatus("ready");
    } catch (error) {
      setEditorStatus("error");
      setEditorErrorMessage(toErrorMessage(error));
    }
  }

  function closeEditorPanel() {
    setPanelMode("detail");
    setEditorStatus("idle");
    setEditorProject(null);
    setEditorErrorMessage(null);
  }

  function openBulkPanel(intent: BulkIntent) {
    setPanelMode("detail");
    setBulkIntent(intent);
    setBulkErrorMessage(null);
    setBulkResult(null);
  }

  function closeBulkPanel() {
    setBulkIntent(null);
    setBulkErrorMessage(null);
    setBulkResult(null);
  }

  async function submitProject(params: {
    project: ProjectUpsertPayload;
    templateId: ProjectTemplateId | null;
    applyTemplateAfterCreate: boolean;
  }) {
    setMutationState("saving");
    setEditorErrorMessage(null);
    setNotice(null);

    try {
      if (panelMode === "create") {
        const response = await requestApi<{ ok: true; projectId: string }>("/api/projects", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params.project),
        });

        if (params.applyTemplateAfterCreate && params.templateId) {
          await requestApi<ProjectTemplateApplyResponse>(
            `/api/projects/${response.projectId}/apply-template`,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                templateId: params.templateId,
                restartIfRunning: false,
              }),
            },
          );
        }

        setNotice({
          tone: "success",
          text:
            params.applyTemplateAfterCreate && params.templateId
              ? `机器人 ${response.projectId} 已创建，并套用了 ${params.templateId} 模板。`
              : `机器人 ${response.projectId} 已创建。`,
        });
        closeEditorPanel();
        reloadProjects(response.projectId);
        return;
      }

      const projectId = editorProject?.id ?? params.project.id;
      const response = await requestApi<{ ok: true; projectId: string }>(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params.project),
      });
      setNotice({
        tone: "success",
        text: `机器人 ${response.projectId} 已更新。`,
      });
      closeEditorPanel();
      reloadProjects(response.projectId);
    } catch (error) {
      setEditorErrorMessage(toErrorMessage(error));
    } finally {
      setMutationState("idle");
    }
  }

  async function applyTemplateToProject(
    projectId: string,
    payload: {
      templateId: ProjectTemplateId;
      restartIfRunning: boolean;
    },
  ) {
    setTemplateApplyProjectId(projectId);
    setNotice(null);

    try {
      const response = await requestApi<ProjectTemplateApplyResponse>(
        `/api/projects/${projectId}/apply-template`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const restartDetail = response.restartTriggered
        ? response.result?.ok
          ? "运行中的机器人已经重启。"
          : `重启失败：${response.result?.stderr || response.result?.stdout || "请查看动作历史。"}`
        : "当前未运行，没有触发重启。";

      setNotice({
        tone: response.ok ? "success" : "error",
        text: `${projectId} 已套用 ${response.templateId} 模板。${restartDetail}`,
      });
      reloadProjects(projectId);
    } catch (error) {
      setNotice({
        tone: "error",
        text: toErrorMessage(error),
      });
    } finally {
      setTemplateApplyProjectId(null);
    }
  }

  async function deleteProject(projectId: string) {
    if (!window.confirm(`确认删除机器人 ${projectId} 吗？`)) {
      return;
    }

    setMutationState("deleting");
    setNotice(null);

    try {
      await requestApi<null>(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      setSelectedIds((current) => current.filter((id) => id !== projectId));
      if (activeId === projectId) {
        setActiveId(null);
      }
      if (editorProject?.id === projectId) {
        closeEditorPanel();
      }
      setNotice({
        tone: "success",
        text: `机器人 ${projectId} 已删除。`,
      });
      reloadProjects();
    } catch (error) {
      setNotice({
        tone: "error",
        text: toErrorMessage(error),
      });
    } finally {
      setMutationState("idle");
    }
  }

  async function runProjectAction(projectId: string, action: ProjectActionName) {
    setActiveProjectAction(action);
    setNotice(null);

    try {
      const response = await requestApi<ProjectActionResponse>(`/api/projects/${projectId}/actions/${action}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      const detail = response.result.stderr || response.result.stdout || "命令已执行。";
      setNotice({
        tone: response.ok ? "success" : "error",
        text: `${projectId} ${action} ${response.ok ? "完成" : "失败"}：${detail}`,
      });
      reloadProjects(projectId);
    } catch (error) {
      setNotice({
        tone: "error",
        text: toErrorMessage(error),
      });
    } finally {
      setActiveProjectAction(null);
    }
  }

  async function submitBulkAction(payload: BulkActionExecutePayload) {
    setMutationState("bulk");
    setBulkErrorMessage(null);
    setBulkResult(null);
    setNotice(null);

    try {
      const response = await requestApi<BulkActionResponse>("/api/bulk/execute", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      setBulkResult(response);
      setNotice({
        tone: response.ok ? "success" : "error",
        text: `${response.results.filter((entry) => entry.ok).length}/${response.results.length} 个机器人执行成功。`,
      });
      reloadProjects(activeId);
    } catch (error) {
      setBulkErrorMessage(toErrorMessage(error));
    } finally {
      setMutationState("idle");
    }
  }

  async function scanProjectCompatibility(projectId: string) {
    setCompatibilityScanProjectId(projectId);
    setNotice(null);

    try {
      const response = await requestApi<ProjectCompatibilityScanResponse>(
        `/api/projects/${projectId}/scan-compatibility`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
        },
      );
      setNotice({
        tone: "success",
        text: `${projectId} 兼容性已更新为 ${response.compatibility.status}。`,
      });
      reloadProjects(projectId);
    } catch (error) {
      setNotice({
        tone: "error",
        text: toErrorMessage(error),
      });
    } finally {
      setCompatibilityScanProjectId(null);
    }
  }

  async function runProjectSmokeTest(projectId: string) {
    setSmokeTestProjectId(projectId);
    setNotice(null);

    try {
      const response = await requestApi<ProjectSmokeTestResponse>(`/api/projects/${projectId}/smoke-test`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      setSmokeTestResult(response);
      setNotice({
        tone: response.ok ? "success" : "error",
        text: `${projectId} 测试 ${response.summary.passed}/${response.summary.total} 通过。当前模型：${response.summary.provider ?? "unknown"}/${response.summary.model ?? "unknown"}`,
      });
      reloadProjects(projectId);
    } catch (error) {
      setNotice({
        tone: "error",
        text: toErrorMessage(error),
      });
    } finally {
      setSmokeTestProjectId(null);
    }
  }

  async function updateProjectModel(
    projectId: string,
    payload: {
      modelRef: string;
      restartIfRunning: boolean;
    },
  ) {
    setModelUpdateProjectId(projectId);
    setNotice(null);

    try {
      const response = await requestApi<ProjectModelUpdateResponse>(`/api/projects/${projectId}/model`, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const restartDetail = response.restartTriggered
        ? response.result?.ok
          ? "运行中的机器人已经重启。"
          : `重启失败：${response.result?.stderr || response.result?.stdout || "请查看动作历史。"}`
        : "当前未运行，没有触发重启。";

      setNotice({
        tone: response.ok ? "success" : "error",
        text: `${projectId} 默认模型已切到 ${response.model.primaryRef ?? payload.modelRef}。${restartDetail}`,
      });
      reloadProjects(projectId);
    } catch (error) {
      setNotice({
        tone: "error",
        text: toErrorMessage(error),
      });
    } finally {
      setModelUpdateProjectId(null);
    }
  }

  async function updateProjectMemoryMode(
    projectId: string,
    payload: {
      mode: "normal" | "locked" | "stateless";
      restartIfRunning: boolean;
    },
  ) {
    setMemoryUpdateProjectId(projectId);
    setNotice(null);

    try {
      const response = await requestApi<ProjectMemoryModeUpdateResponse>(
        `/api/projects/${projectId}/memory-mode`,
        {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const restartDetail = response.restartTriggered
        ? response.result?.ok
          ? "运行中的机器人已经重启。"
          : `重启失败：${response.result?.stderr || response.result?.stdout || "请查看动作历史。"}`
        : "当前未运行，没有触发重启。";

      setNotice({
        tone: response.ok ? "success" : "error",
        text: `${projectId} 记忆策略已切到 ${response.memory.mode}。${restartDetail}`,
      });
      reloadProjects(projectId);
    } catch (error) {
      setNotice({
        tone: "error",
        text: toErrorMessage(error),
      });
    } finally {
      setMemoryUpdateProjectId(null);
    }
  }

  async function manageProjectCatalogEntry(params: {
    kind: "hook" | "skill";
    projectId: string;
    name: string;
    mode: "enable" | "disable" | "remove";
  }) {
    const normalizedName = params.name.trim();
    if (normalizedName.length === 0) {
      setNotice({
        tone: "error",
        text: `${params.kind === "hook" ? "Hook" : "Skill"} 名称不能为空。`,
      });
      return;
    }

    const actionKey = `${params.kind}:${params.projectId}:${normalizedName}:${params.mode}`;
    setCatalogActionKey(actionKey);
    setNotice(null);

    const payload: BulkActionExecutePayload =
      params.kind === "hook"
        ? params.mode === "remove"
          ? {
              action: "config",
              projectIds: [params.projectId],
              payload: {
                mode: "delete",
                path: `hooks.internal.entries.${normalizedName}`,
              },
            }
          : {
              action: "hooks",
              projectIds: [params.projectId],
              payload: {
                mode: params.mode,
                hookName: normalizedName,
              },
            }
        : params.mode === "remove"
          ? {
              action: "config",
              projectIds: [params.projectId],
              payload: {
                mode: "delete",
                path: `skills.entries.${normalizedName}`,
              },
            }
          : {
              action: "skills",
              projectIds: [params.projectId],
              payload: {
                mode: params.mode,
                skillName: normalizedName,
              },
            };

    try {
      const response = await requestApi<BulkActionResponse>("/api/bulk/execute", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = response.results[0];
      setNotice({
        tone: result?.ok ? "success" : "error",
        text:
          result?.message ??
          `${params.projectId} ${params.kind === "hook" ? "Hook" : "Skill"} 操作已提交。`,
      });
      reloadProjects(params.projectId);
    } catch (error) {
      setNotice({
        tone: "error",
        text: toErrorMessage(error),
      });
    } finally {
      setCatalogActionKey(null);
    }
  }

  const { theme, toggle: toggleTheme } = useTheme();

  let overlayPanel: React.ReactNode = null;

  if (panelMode === "create") {
    overlayPanel = (
      <ProjectEditor
        mode="create"
        managerAuth={data?.managerAuth ?? null}
        templates={templates}
        initialProject={null}
        busy={mutationState === "saving"}
        errorMessage={editorErrorMessage}
        onCancel={closeEditorPanel}
        onSubmit={submitProject}
      />
    );
  } else if (panelMode === "edit") {
    if (editorStatus === "loading") {
      overlayPanel = (
        <aside className="detail-panel">
          <p className="panel-kicker">编辑机器人</p>
          <h2>正在读取详情</h2>
          <p className="muted-copy">正在加载机器人设置，请稍候。</p>
        </aside>
      );
    } else if (editorStatus === "error") {
      overlayPanel = (
        <aside className="detail-panel">
          <p className="panel-kicker">编辑机器人</p>
          <h2>读取失败</h2>
          <div className="callout-box callout-box-danger">
            {editorErrorMessage ?? "无法读取这个机器人的详情。"}
          </div>
          <div className="panel-action-row">
            <button type="button" className="ghost-button" onClick={closeEditorPanel}>
              返回详情
            </button>
          </div>
        </aside>
      );
    } else {
      overlayPanel = (
        <ProjectEditor
          mode="edit"
          managerAuth={data?.managerAuth ?? null}
          templates={templates}
          initialProject={editorProject}
          busy={mutationState === "saving"}
          errorMessage={editorErrorMessage}
          onCancel={closeEditorPanel}
          onSubmit={submitProject}
        />
      );
    }
  } else if (bulkIntent && selectedProjects.length > 0) {
    overlayPanel = (
      <BulkActionPanel
        intent={bulkIntent}
        selectedProjects={selectedProjects}
        busy={mutationState === "bulk"}
        errorMessage={bulkErrorMessage}
        result={bulkResult}
        onCancel={closeBulkPanel}
        onSubmit={submitBulkAction}
      />
    );
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">OPENCLAW</p>
          <h1>机器人管理</h1>
        </div>

        <div className="hero-actions">
          <button type="button" className="primary-button" onClick={openCreatePanel}>
            创建新机器人
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setReloadToken((value) => value + 1)}
          >
            刷新
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "wh40k" ? "切换到标准主题" : "切换到战锤40K主题"}
          >
            {theme === "wh40k" ? "\uD83D\uDDA5\uFE0F" : "\u2694\uFE0F"}
          </button>
        </div>
      </section>

      <section className="summary-grid">
        <article className="summary-card">
          <span className="summary-label">机器人总数</span>
          <strong>{data?.summary.totalProjects ?? 0}</strong>
          <span className="summary-hint">已创建的机器人数量</span>
        </article>
        <article className="summary-card">
          <span className="summary-label">运行中</span>
          <strong>{data?.summary.runningProjects ?? 0}</strong>
          <span className="summary-hint">当前正在运行</span>
        </article>
        <article className="summary-card">
          <span className="summary-label">在线</span>
          <strong>{data?.summary.healthyProjects ?? 0}</strong>
          <span className="summary-hint">运行且响应正常</span>
        </article>
      </section>

      {notice ? (
        <section className={`inline-notice inline-notice-${notice.tone}`}>
          <strong>{notice.tone === "success" ? "操作成功" : "操作失败"}</strong>
          <span>{notice.text}</span>
        </section>
      ) : null}

      {selectedProjects.length > 0 ? (
        <BulkToolbar
          selectedProjects={selectedProjects}
          bulkIntent={bulkIntent}
          onIntentChange={openBulkPanel}
          onSelectAll={selectAllFiltered}
          onClearSelection={clearSelection}
        />
      ) : null}

      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div>
            <h2>我的机器人</h2>
          </div>
        </div>

        {status === "loading" ? (
          <div className="state-card">
            <h3>正在加载</h3>
            <p>正在获取机器人列表，请稍候。</p>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="state-card state-card-error">
            <h3>加载失败</h3>
            <p>{errorMessage}</p>
          </div>
        ) : null}

        {status === "ready" ? (
          <>
            <label className="search-input" style={{ marginTop: 18 }}>
              <span>搜索</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索机器人..."
              />
            </label>

            {overlayPanel ? (
              <div style={{ marginTop: 18 }}>{overlayPanel}</div>
            ) : null}

            {filteredProjects.length === 0 ? (
              <div className="state-card state-card-empty" style={{ marginTop: 18 }}>
                <h3>没有匹配的机器人</h3>
                <p>试试清空搜索条件，或者先创建一个新机器人。</p>
              </div>
            ) : (
              <div className="projects-grid">
                {filteredProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    selected={selectedIds.includes(project.id)}
                    expanded={project.id === activeId}
                    managerAuth={data?.managerAuth ?? null}
                    bulkIntent={bulkIntent}
                    selectedCount={selectedProjects.length}
                    deleting={mutationState === "deleting" && project.id === activeId}
                    activeAction={project.id === activeId ? activeProjectAction : null}
                    scanningCompatibility={compatibilityScanProjectId === project.id}
                    smokeTesting={smokeTestProjectId === project.id}
                    modelUpdating={modelUpdateProjectId === project.id}
                    memoryUpdating={memoryUpdateProjectId === project.id}
                    templateApplying={templateApplyProjectId === project.id}
                    catalogActionKey={catalogActionKey}
                    smokeTestResult={smokeTestResult}
                    templates={templates}
                    onToggleExpand={toggleExpandProject}
                    onToggleSelection={toggleProjectSelection}
                    onEdit={openEditPanel}
                    onDelete={deleteProject}
                    onRunAction={runProjectAction}
                    onScanCompatibility={scanProjectCompatibility}
                    onRunSmokeTest={runProjectSmokeTest}
                    onUpdateModel={updateProjectModel}
                    onUpdateMemoryMode={updateProjectMemoryMode}
                    onApplyTemplate={applyTemplateToProject}
                    onManageHook={(projectId, name, mode) =>
                      manageProjectCatalogEntry({
                        kind: "hook",
                        projectId,
                        name,
                        mode,
                      })
                    }
                    onManageSkill={(projectId, name, mode) =>
                      manageProjectCatalogEntry({
                        kind: "skill",
                        projectId,
                        name,
                        mode,
                      })
                    }
                  />
                ))}
              </div>
            )}

            <ActionHistoryPanel
              title={expandedProject ? `${expandedProject.name} 最近操作` : "最近操作"}
              subtitle={
                expandedProject
                  ? "显示这个机器人最近的操作记录。"
                  : "显示最近的操作记录"
              }
              items={visibleHistoryItems}
              emptyMessage={
                expandedProject
                  ? "这个机器人还没有操作记录。"
                  : "还没有任何操作记录，执行一次操作后这里就会出现。"
              }
            />
          </>
        ) : null}
      </section>
    </main>
  );
}

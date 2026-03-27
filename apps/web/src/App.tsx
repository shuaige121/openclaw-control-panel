import { ActionHistoryPanel } from "./components/action-history-panel";
import { useEffect, useMemo, useState } from "react";
import { BulkActionPanel } from "./components/bulk-action-panel";
import { BulkToolbar } from "./components/bulk-toolbar";
import { ProjectEditor } from "./components/project-editor";
import { ProjectCard } from "./components/project-card";
import { ProjectDetail } from "./components/project-detail";
import type {
  ActionHistoryResponse,
  BulkActionExecutePayload,
  BulkActionResponse,
  BulkIntent,
  ProjectDetailResponse,
  ProjectActionName,
  ProjectActionResponse,
  ProjectCompatibilityScanResponse,
  ProjectCreateResponse,
  ProjectMemoryModeUpdateResponse,
  ProjectModelUpdateResponse,
  ProjectTemplateApplyResponse,
  ProjectTemplateDefinition,
  ProjectTemplateId,
  ProjectTemplateListResponse,
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
    if (filteredProjects.length === 0) {
      setActiveId(null);
      return;
    }

    const activeStillExists = filteredProjects.some((project) => project.id === activeId);
    if (!activeStillExists) {
      setActiveId(filteredProjects[0]?.id ?? null);
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
  const activeProject = filteredProjects.find((project) => project.id === activeId) ?? null;
  const visibleHistoryItems = useMemo(() => {
    const items = historyData?.items ?? [];
    if (!activeProject) {
      return items.slice(0, 8);
    }

    return items
      .filter((entry) => entry.projects.some((project) => project.id === activeProject.id))
      .slice(0, 6);
  }, [activeProject, historyData]);

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
    project: Record<string, unknown>;
    templateId: ProjectTemplateId | null;
    applyTemplateAfterCreate: boolean;
    createInstance: boolean;
  }) {
    setMutationState("saving");
    setEditorErrorMessage(null);
    setNotice(null);

    try {
      if (panelMode === "create") {
        const response = await requestApi<ProjectCreateResponse>("/api/projects", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params.project),
        });

        if (!params.createInstance && params.applyTemplateAfterCreate && params.templateId) {
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
            response.instance
              ? `项目 ${response.projectId} 已创建。端口 ${response.instance.port} 已分配${
                  response.appliedTemplateId ? `，并套用了 ${response.appliedTemplateId} 模板。` : "。"
                }`
              : params.applyTemplateAfterCreate && params.templateId
                ? `项目 ${response.projectId} 已创建，并套用了 ${params.templateId} 模板。`
                : `项目 ${response.projectId} 已写入注册表。`,
        });
        closeEditorPanel();
        reloadProjects(response.projectId);
        return;
      }

      const projectId =
        editorProject?.id ??
        (typeof params.project.id === "string" ? params.project.id : "");
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
        text: `项目 ${response.projectId} 已更新。`,
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
          ? "运行中的项目已经重启。"
          : `重启失败：${response.result?.stderr || response.result?.stdout || "请查看动作历史。"}`
        : "项目当前未运行，没有触发重启。";

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
    if (!window.confirm(`确认删除项目 ${projectId} 吗？这会从 manager 注册表中移除它。`)) {
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
        text: `项目 ${projectId} 已从注册表删除。`,
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
        text: `${response.results.filter((entry) => entry.ok).length}/${response.results.length} 个项目执行成功。`,
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
          ? "运行中的项目已经重启。"
          : `重启失败：${response.result?.stderr || response.result?.stdout || "请查看动作历史。"}`
        : "项目当前未运行，没有触发重启。";

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
          ? "运行中的项目已经重启。"
          : `重启失败：${response.result?.stderr || response.result?.stdout || "请查看动作历史。"}`
        : "项目当前未运行，没有触发重启。";

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

  let sidePanel;

  if (panelMode === "create") {
    sidePanel = (
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
      sidePanel = (
        <aside className="detail-panel">
          <p className="panel-kicker">编辑项目</p>
          <h2>正在读取注册表详情</h2>
          <p className="muted-copy">准备把 gateway、路径和命令字段填进编辑表单。</p>
        </aside>
      );
    } else if (editorStatus === "error") {
      sidePanel = (
        <aside className="detail-panel">
          <p className="panel-kicker">编辑项目</p>
          <h2>读取失败</h2>
          <div className="callout-box callout-box-danger">
            {editorErrorMessage ?? "无法读取这个项目的注册表详情。"}
          </div>
          <div className="panel-action-row">
            <button type="button" className="ghost-button" onClick={closeEditorPanel}>
              返回详情
            </button>
          </div>
        </aside>
      );
    } else {
      sidePanel = (
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
    sidePanel = (
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
  } else {
    sidePanel = (
      <div className="detail-stack">
        <ProjectDetail
          project={activeProject}
          managerAuth={data?.managerAuth ?? null}
          bulkIntent={bulkIntent}
          selectedCount={selectedProjects.length}
          deleting={mutationState === "deleting"}
          activeAction={activeProjectAction}
          scanningCompatibility={compatibilityScanProjectId === activeProject?.id}
          modelUpdating={modelUpdateProjectId === activeProject?.id}
          memoryUpdating={memoryUpdateProjectId === activeProject?.id}
          templateApplying={templateApplyProjectId === activeProject?.id}
          catalogActionKey={catalogActionKey}
          templates={templates}
          onEdit={openEditPanel}
          onDelete={deleteProject}
          onRunAction={runProjectAction}
          onScanCompatibility={scanProjectCompatibility}
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
        <ActionHistoryPanel
          title={activeProject ? `${activeProject.name} 最近动作` : "全局最近动作"}
          subtitle={
            activeProject
              ? "这里会保留这个项目最近的生命周期、批量变更和注册表修改记录。"
              : "这里会保留整个 manager 最近的操作记录。"
          }
          items={visibleHistoryItems}
          emptyMessage={
            activeProject
              ? "这个项目还没有动作历史。"
              : "还没有任何动作历史，执行一次操作后这里就会出现。"
          }
        />
      </div>
    );
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">OpenClaw Manager</p>
          <h1>一个控制面板，管理多个原始 OpenClaw 项目。</h1>
          <p className="hero-lede">
            面向运行多个 OpenClaw gateway 的团队。
            Manager 负责项目总览、健康探测、生命周期动作、批量操作和入口跳转；
            单项目深控继续交给各自的 OpenClaw Control UI。
          </p>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => setReloadToken((value) => value + 1)}
          >
            刷新项目
          </button>
          <button type="button" className="ghost-button" onClick={openCreatePanel}>
            新增项目
          </button>
        </div>
      </section>

      <section className="summary-grid">
        <article className="summary-card">
          <span className="summary-label">项目总数</span>
          <strong>{data?.summary.totalProjects ?? 0}</strong>
          <span className="summary-hint">一项目一 Gateway</span>
        </article>
        <article className="summary-card">
          <span className="summary-label">运行中</span>
          <strong>{data?.summary.runningProjects ?? 0}</strong>
          <span className="summary-hint">可直接打开 Control UI</span>
        </article>
        <article className="summary-card">
          <span className="summary-label">健康</span>
          <strong>{data?.summary.healthyProjects ?? 0}</strong>
          <span className="summary-hint">基于项目级探针统计</span>
        </article>
        <article className="summary-card">
          <span className="summary-label">Auth 覆盖</span>
          <strong>{data?.summary.authOverrides ?? 0}</strong>
          <span className="summary-hint">其余项目继承 manager 默认 auth</span>
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
            <p className="panel-kicker">项目视图</p>
            <h2>项目卡片 + 右侧详情</h2>
          </div>

          <label className="search-input">
            <span>搜索</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="按项目名、路径、tag、auth 搜索"
            />
          </label>
        </div>

        {status === "loading" ? (
          <div className="state-card">
            <h3>正在加载项目</h3>
            <p>请求同源 `GET /api/projects`，准备构建 manager 视图。</p>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="state-card state-card-error">
            <h3>项目列表加载失败</h3>
            <p>{errorMessage}</p>
          </div>
        ) : null}

        {status === "ready" ? (
          <div className="workspace-grid">
            <div className="project-column">
              {filteredProjects.length === 0 ? (
                <div className="state-card state-card-empty">
                  <h3>没有匹配的项目</h3>
                  <p>试试清空搜索条件，或者先新增一个要纳管的 OpenClaw 项目。</p>
                </div>
              ) : (
                <div className="project-grid">
                  {filteredProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      selected={selectedIds.includes(project.id)}
                      active={project.id === activeId}
                      onSelect={setActiveId}
                      onToggleSelection={toggleProjectSelection}
                    />
                  ))}
                </div>
              )}
            </div>

            {sidePanel}
          </div>
        ) : null}
      </section>
    </main>
  );
}

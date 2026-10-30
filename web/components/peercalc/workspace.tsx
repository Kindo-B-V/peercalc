"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  GRID_ROW_HEIGHT,
  useGridVirtualizer,
} from "../../src/client/use-grid-virtualizer";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleAlert,
  Cloud,
  CloudOff,
  Copy,
  FileText,
  FolderClosed,
  FolderPlus,
  History,
  LayoutList,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  Plus,
  Printer,
  Redo2,
  Search,
  Settings2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  calculateProject,
  computeKostprijsBreakdown,
  computeBtwLaagDirect,
  createItem,
  createProject,
  createSampleProject,
  getCalculationItems,
  getGrandTotal,
  getKostprijs,
  getLaborHours,
  getStaartBreakdown,
  parseProject,
  stringifyProject,
  type CostItem,
  type ProjectFile,
  type RowType,
} from "../../src/domain";

type User = { userId: string; displayName: string; email: string };
type ProjectSummary = {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
type SavedProject = ProjectSummary & { document: ProjectFile };
type Version = {
  revision: number;
  name: string;
  createdAt: string;
  message: string;
};
type Tab = "estimate" | "tail" | "report" | "project";
const DRAFT_KEY = "peercalc-recovery-v1";
const number = (value: number | null | undefined, digits = 2) =>
  new Intl.NumberFormat("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value ?? 0);
const formatMoney = (value: number | null | undefined, currency: string) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format(
    value ?? 0,
  );
const date = (value: string) =>
  new Date(value).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const isTail = (item: CostItem) => item.rowType.startsWith("staart_");
const rowNames: Record<string, string> = {
  chapter: "Hoofdstuk",
  begrotingspost: "Begrotingspost",
  bewakingspost: "Bewakingspost",
  regel: "Middel",
  tekstregel: "Tekstregel",
  witregel: "Witregel",
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "Er staat een nieuwere versie in de opslag. Exporteer je wijzigingen en open de opgeslagen versie opnieuw."
        : result.error || "De aanvraag is mislukt.",
    );
  return result;
}

function Tool({
  label,
  children,
  onClick,
  disabled = false,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`icon-button ${className}`}
    >
      {children}
    </button>
  );
}

export default function Workspace() {
  const [document, setDocument] = useState<ProjectFile | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [saved, setSaved] = useState<ProjectSummary | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("estimate");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [undo, setUndo] = useState<ProjectFile[]>([]);
  const [redo, setRedo] = useState<ProjectFile[]>([]);
  const [exportFormat, setExportFormat] = useState("ocs");
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const gridScroll = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const draftKey = useRef<string | null>(null);

  useEffect(() => {
    setDocument(calculateProject(createSampleProject()));
    api<{ user: User | null }>("/api/me")
      .then(async ({ user: identity }) => {
        setUser(identity);
        draftKey.current = `${DRAFT_KEY}:${identity?.userId ?? "anonymous"}`;
        try {
          const recovery = localStorage.getItem(draftKey.current);
          if (
            recovery &&
            window.confirm("Een niet-opgeslagen begroting herstellen?")
          ) {
            const value = JSON.parse(recovery);
            setDocument(
              calculateProject(parseProject(JSON.stringify(value.document))),
            );
            setDirty(true);
            setNotice(
              "Lokaal concept hersteld. Sla op als nieuwe begroting of exporteer het bestand.",
            );
          }
        } catch {
          setNotice("Het lokale concept kon niet worden hersteld.");
        }
        if (identity)
          setProjects(
            (await api<{ projects: ProjectSummary[] }>("/api/projects"))
              .projects,
          );
      })
      .catch((err) => setError(err.message))
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!dirty || !document || !draftKey.current) return;
    try {
      localStorage.setItem(draftKey.current, JSON.stringify({ document }));
    } catch {
      setNotice(
        "Lokale conceptherstelruimte is vol. Exporteer of sla op in de werkruimte.",
      );
    }
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [document, dirty]);

  useEffect(() => {
    if (versions === null) return;
    const previous = window.document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input, select, textarea, [tabindex='0']",
        ) ?? [],
      );
    focusables()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVersions(null);
      if (event.key !== "Tab") return;
      const controls = focusables();
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && window.document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && window.document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.document.addEventListener("keydown", handleKey);
    return () => {
      window.document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, [versions]);

  const calculated = useMemo(
    () => (document ? calculateProject(document) : null),
    [document],
  );
  const calculationItems = useMemo(
    () => (calculated ? getCalculationItems(calculated) : []),
    [calculated],
  );
  const childParents = useMemo(
    () =>
      new Set(calculationItems.map((item) => item.parentId).filter(Boolean)),
    [calculationItems],
  );
  const money = (value: number | null | undefined) =>
    formatMoney(value, calculated?.schedule.currency || "EUR");
  const selected = calculationItems.find((item) => item.id === selectedId);
  const chapters = useMemo(
    () => calculationItems.filter((item) => item.rowType === "chapter"),
    [calculationItems],
  );
  const tails = useMemo(
    () => calculationItems.filter(isTail),
    [calculationItems],
  );
  const summary = useMemo(
    () => ({
      breakdown: computeKostprijsBreakdown(calculationItems),
      tail: getStaartBreakdown(calculationItems),
      direct: getKostprijs(calculationItems),
      total: getGrandTotal(calculationItems),
      hours: getLaborHours(calculationItems),
    }),
    [calculationItems],
  );
  const breakdown = summary.breakdown;
  const tailBreakdown = summary.tail;

  function edit(next: ProjectFile) {
    if (!document) return;
    try {
      const valid = calculateProject({
        ...next,
        modifiedAt: new Date().toISOString(),
      });
      setUndo((history) => [...history.slice(-29), document]);
      setRedo([]);
      setDocument(valid);
      setDirty(true);
      setNotice("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ongeldige wijziging.");
    }
  }

  function updateItem(id: string, updates: Partial<CostItem>) {
    if (!document) return;
    edit({
      ...document,
      items: document.items.map((item) =>
        item.id === id ? { ...item, ...updates } : item,
      ),
    });
  }

  function updateSchedule(updates: Partial<ProjectFile["schedule"]>) {
    if (document)
      edit({ ...document, schedule: { ...document.schedule, ...updates } });
  }

  function canLeave() {
    return (
      !dirty ||
      window.confirm(
        "Niet-opgeslagen wijzigingen verlaten? Exporteer of sla eerst op om ze te bewaren.",
      )
    );
  }
  function replaceDocument(
    next: ProjectFile,
    cloud: ProjectSummary | null = null,
  ) {
    setDocument(calculateProject(next));
    setSaved(cloud);
    setDirty(false);
    setUndo([]);
    setRedo([]);
    setSelectedId(null);
    setChapterId(null);
    setCollapsed(new Set());
    setQuery("");
    setVersions(null);
    try {
      if (draftKey.current) localStorage.removeItem(draftKey.current);
    } catch {
      /* Storage can be blocked in private browser sessions. */
    }
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "De actie is mislukt.");
    } finally {
      setBusy(false);
    }
  }
  async function refreshProjects() {
    setProjects(
      (await api<{ projects: ProjectSummary[] }>("/api/projects")).projects,
    );
  }
  async function save() {
    if (!calculated || !user) return;
    await run(async () => {
      const { project } = await api<{ project: SavedProject }>(
        saved ? `/api/projects/${saved.id}` : "/api/projects",
        {
          method: saved ? "PUT" : "POST",
          body: JSON.stringify({
            name: calculated.schedule.name,
            document: calculated,
            ...(saved ? { expectedRevision: saved.revision } : {}),
          }),
        },
      );
      replaceDocument(project.document, project);
      setNotice(`Opgeslagen als versie ${project.revision}.`);
      await refreshProjects();
    });
  }
  async function openProject(id: string) {
    if (!canLeave()) return;
    await run(async () => {
      const { project } = await api<{ project: SavedProject }>(
        `/api/projects/${id}`,
      );
      replaceDocument(project.document, project);
      setSidebarOpen(false);
    });
  }
  function newProject() {
    if (!canLeave()) return;
    replaceDocument(createProject("Nieuwe begroting"));
    setDirty(true);
    setTab("project");
    setSidebarOpen(false);
  }
  function duplicate() {
    if (!calculated || !canLeave()) return;
    const copy = structuredClone(calculated);
    copy.schedule.name += " (kopie)";
    replaceDocument(copy);
    setDirty(true);
    setNotice("Kopie aangemaakt als lokaal concept.");
  }
  async function removeProject() {
    if (
      !saved ||
      !window.confirm(
        `'${saved.name}' met alle versies uit de werkruimte verwijderen?`,
      )
    )
      return;
    await run(async () => {
      await api(`/api/projects/${saved.id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedRevision: saved.revision }),
      });
      replaceDocument(createProject());
      await refreshProjects();
    });
  }
  async function importFile(file: File) {
    if (!canLeave()) return;
    await run(async () => {
      const legacy = file.name.toLowerCase().endsWith(".calc");
      if (file.size > (legacy ? 12 : 20) * 1024 * 1024)
        throw new Error(`Dit bestand is groter dan ${legacy ? 12 : 20} MB.`);
      const imported = legacy
        ? (await import("../../src/domain/wpcalc")).importWpCalc(
            await file.arrayBuffer(),
            file.name,
          )
        : parseProject(await file.text());
      replaceDocument(imported);
      setDirty(true);
      setNotice(`${file.name} geimporteerd als nieuw concept.`);
    });
  }
  async function exportFile(extension = exportFormat) {
    if (!calculated) return;
    await run(async () => {
      let blob: Blob;
      if (extension === "calc") {
        const response = await fetch("/api/exchange/calc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document: calculated }),
        });
        if (!response.ok) {
          const result = (await response.json()) as { error?: string };
          throw new Error(result.error || "WPCalc-export is mislukt.");
        }
        blob = await response.blob();
      } else
        blob = new Blob([stringifyProject(calculated)], {
          type: "application/json",
        });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${calculated.schedule.name.replace(/[\\/:*?"<>|]/g, "_")}.${extension}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function addRow(rowType: RowType) {
    if (!document) return;
    const parent =
      rowType === "chapter"
        ? null
        : selected &&
            !isTail(selected) &&
            !["regel", "tekstregel", "witregel"].includes(selected.rowType)
          ? selected
          : document.items.find(
              (item) => item.id === (selected?.parentId ?? chapterId),
            );
    const item = createItem({
      rowType,
      branchId: document.schedule.branchesEnabled
        ? (document.schedule.activeBranchId ?? "main")
        : null,
      parentId: parent?.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      sortOrder: document.items.length,
      description:
        rowType === "chapter"
          ? "Nieuw hoofdstuk"
          : rowType === "regel"
            ? "Nieuw middel"
            : "Nieuwe begrotingspost",
      quantity: rowType === "chapter" ? null : 1,
      unit: "st",
    });
    const items = [...document.items];
    let index = parent
      ? items.findIndex((row) => row.id === parent.id) + 1
      : items.findIndex(isTail);
    if (parent)
      while (
        index < items.length &&
        items[index].depth > parent.depth &&
        !isTail(items[index])
      )
        index++;
    if (index < 0) index = items.length;
    items.splice(index, 0, item);
    edit({ ...document, items });
    setSelectedId(item.id);
    setCollapsed((current) => {
      const next = new Set(current);
      if (parent) next.delete(parent.id);
      return next;
    });
  }
  function deleteRow() {
    if (!document || !selected) return;
    const ids = new Set([selected.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of document.items)
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id);
          changed = true;
        }
    }
    if (
      !window.confirm(
        `'${selected.description}'${ids.size > 1 ? ` en ${ids.size - 1} onderliggende regels` : ""} verwijderen?`,
      )
    )
      return;
    edit({
      ...document,
      items: document.items.filter((item) => !ids.has(item.id)),
    });
    setSelectedId(null);
  }
  async function loadVersions() {
    if (!saved) return;
    await run(async () => {
      setVersions(
        (
          await api<{ versions: Version[] }>(
            `/api/projects/${saved.id}/versions`,
          )
        ).versions,
      );
    });
  }
  async function restoreVersion(revision: number) {
    if (
      !saved ||
      !canLeave() ||
      !window.confirm(`Versie ${revision} herstellen als nieuwe versie?`)
    )
      return;
    await run(async () => {
      const { project } = await api<{ project: SavedProject }>(
        `/api/projects/${saved.id}/restore`,
        {
          method: "POST",
          body: JSON.stringify({ revision, expectedRevision: saved.revision }),
        },
      );
      replaceDocument(project.document, project);
      await refreshProjects();
      setNotice(`Versie ${revision} hersteld als versie ${project.revision}.`);
    });
  }
  function stepHistory(direction: "undo" | "redo") {
    if (!document) return;
    const source = direction === "undo" ? undo : redo;
    const next = source.at(-1);
    if (!next) return;
    if (direction === "undo") {
      setUndo(source.slice(0, -1));
      setRedo([...redo, document]);
    } else {
      setRedo(source.slice(0, -1));
      setUndo([...undo, document]);
    }
    setDocument(next);
    setDirty(true);
  }

  const rows = useMemo(() => {
    if (!calculated) return [];
    const hidden = new Set<string>();
    const descendants = new Set(chapterId ? [chapterId] : []);
    for (const row of calculationItems) {
      if (
        row.parentId &&
        (collapsed.has(row.parentId) || hidden.has(row.parentId))
      )
        hidden.add(row.id);
      if (row.parentId && descendants.has(row.parentId))
        descendants.add(row.id);
    }
    return calculationItems.filter(
      (row) =>
        !isTail(row) &&
        !hidden.has(row.id) &&
        (!chapterId || descendants.has(row.id)) &&
        (!query ||
          `${row.code} ${row.description}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    );
  }, [calculated, calculationItems, chapterId, collapsed, query]);
  const virtualRows = useGridVirtualizer(
    gridScroll,
    rows.length,
    rows.findIndex((item) => item.id === focusedRowId),
    JSON.stringify([
      calculated?.schedule.id,
      chapterId,
      query,
      calculated?.schedule.activeBranchId,
    ]),
    tab === "estimate" && !!calculated,
  );

  if (!calculated || !breakdown || !tailBreakdown)
    return (
      <main className="boot">
        <Building2 size={30} />
        <strong>PeerCalc</strong>
        <Loader2 className="spin" size={20} />
      </main>
    );
  const direct = summary.direct;
  const exVat =
    summary.total - tailBreakdown.btwAmount - tailBreakdown.btwLaagAmount;
  const hours = summary.hours;
  const numInput = (
    item: CostItem,
    key: keyof CostItem,
    label: string,
    value: number | null | undefined = item[key] as number | null,
  ) => (
    <input
      aria-label={`${label}: ${item.description}`}
      className="cell-input numeric"
      type="number"
      step="any"
      value={value ?? ""}
      disabled={
        (key === "quantity" &&
          typeof item.wpcalcQuantityFormula === "string") ||
        (item.wpcalcUncalculatedPrice === true &&
          [
            "quantity",
            "normUnitPrice",
            "normQuantity",
            "materialPrice",
            "laborPrice",
            "normFactor",
          ].includes(String(key)))
      }
      title={
        key === "quantity" && typeof item.wpcalcQuantityFormula === "string"
          ? `WPCalc-formule: ${item.wpcalcQuantityFormula}`
          : undefined
      }
      onChange={(event) =>
        updateItem(item.id, {
          [key]: event.target.value === "" ? null : Number(event.target.value),
        })
      }
    />
  );

  return (
    <main
      className="workspace"
      aria-busy={busy || !authReady}
      inert={busy || !authReady ? true : undefined}
    >
      <header className="topbar">
        <div className="brand">
          <Tool
            label="Navigatie"
            className="mobile-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu size={19} />
          </Tool>
          <span className="brand-mark">
            <Building2 size={21} />
          </span>
          <strong>
            PeerCalc<span className="brand-dot">.</span>
          </strong>
          <span className="edition">WORKSPACE</span>
        </div>
        <div className="topbar-center">
          <span className="workspace-label">Mijn werkruimte</span>
          <ChevronRight size={13} />
          <span>{calculated.schedule.projectNumber || "Begrotingen"}</span>
        </div>
        <div className="account">
          {authReady && user ? (
            <>
              <span className="avatar">
                {user.displayName.slice(0, 2).toUpperCase()}
              </span>
              <span className="account-name">{user.displayName}</span>
              <a
                title="Uitloggen"
                aria-label="Uitloggen"
                className="icon-button"
                href="/signout-with-chatgpt?return_to=%2F"
                target="_top"
                onClick={(event) => {
                  if (!canLeave()) {
                    event.preventDefault();
                    return;
                  }
                  try {
                    if (draftKey.current)
                      localStorage.removeItem(draftKey.current);
                  } catch {
                    /* Private storage may be disabled. */
                  }
                }}
              >
                <LogOut size={16} />
              </a>
            </>
          ) : (
            <a
              className="sign-in"
              href="/signin-with-chatgpt?return_to=%2F"
              target="_top"
            >
              <LogIn size={15} />
              Inloggen
            </a>
          )}
        </div>
      </header>

      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="workspace-switch">
          <span className="workspace-avatar">P</span>
          <div>
            <strong>Mijn werkruimte</strong>
            <span>{user ? "Mijn begrotingen" : "Lokale werksessie"}</span>
          </div>
          <Cloud size={16} />
        </div>
        <button className="new-project" onClick={newProject}>
          <Plus size={17} />
          Nieuwe begroting
        </button>
        <div className="sidebar-heading">
          BEGROTINGEN <span>{projects.length}</span>
        </div>
        <div className="project-list">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`project-link ${saved?.id === project.id ? "active" : ""}`}
              disabled={busy}
              onClick={() => openProject(project.id)}
            >
              <FileText size={16} />
              <span>
                {project.name}
                <small>
                  v{project.revision} · {date(project.updatedAt)}
                </small>
              </span>
            </button>
          ))}
          {!saved && (
            <button
              className="project-link active"
              onClick={() => setSidebarOpen(false)}
            >
              <FileText size={16} />
              <span>
                {calculated.schedule.name}
                <small>
                  {dirty ? "Niet opgeslagen" : "Voorbeeldbegroting"}
                </small>
              </span>
            </button>
          )}
        </div>
        <div className="sidebar-heading">
          PROJECTSTRUCTUUR <span>{chapters.length}</span>
        </div>
        <nav className="chapter-list" aria-label="Hoofdstukken">
          <button
            className={!chapterId ? "active" : ""}
            onClick={() => {
              setChapterId(null);
              setTab("estimate");
            }}
          >
            <LayoutList size={15} />
            <span>Volledige begroting</span>
            <span className="chapter-count">
              {calculationItems.filter((item) => !isTail(item)).length}
            </span>
          </button>
          {chapters.map((chapter, index) => (
            <button
              key={chapter.id}
              className={chapterId === chapter.id ? "active" : ""}
              onClick={() => {
                setChapterId(chapter.id);
                setTab("estimate");
                setSidebarOpen(false);
              }}
            >
              <FolderClosed size={15} />
              <span>
                <b>{chapter.code || String(index + 1).padStart(2, "0")}</b>{" "}
                {chapter.description}
              </span>
            </button>
          ))}
        </nav>
        <button
          className="sidebar-tail"
          onClick={() => {
            setTab("tail");
            setSidebarOpen(false);
          }}
        >
          <Settings2 size={16} />
          Uren & staart
          <ChevronRight size={14} />
        </button>
        <div className="sidebar-bottom">
          <div>
            <span className={`status-dot ${user ? "online" : ""}`} />
            {user ? "Opslag verbonden" : "Niet ingelogd"}
          </div>
          <a
            href="https://github.com/OpenAEC-Foundation/open-calc-studio"
            target="_blank"
            rel="noreferrer"
          >
            <CircleHelp size={14} />
            Open Calc Studio-formaat
          </a>
          <small>PeerCalc · Open source</small>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          aria-label="Navigatie sluiten"
          className="sidebar-scrim"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <section className="main-workspace">
        <div className="document-heading">
          <div>
            <div className="breadcrumb">
              <span>Begrotingen</span>
              <ChevronRight size={12} />
              <span>{calculated.schedule.projectNumber || "Concept"}</span>
            </div>
            <div className="title-row">
              <h1>{calculated.schedule.name}</h1>
              <span
                className={`status-badge ${calculated.schedule.status === "FINAL" ? "final" : ""}`}
              >
                {calculated.schedule.status === "FINAL"
                  ? "Definitief"
                  : calculated.schedule.status === "REVISED"
                    ? "Herzien"
                    : "Concept"}
              </span>
              {calculated.schedule.branchesEnabled && (
                <select
                  className="variant-select"
                  aria-label="Begrotingsvariant"
                  value={calculated.schedule.activeBranchId || "main"}
                  onChange={(event) => {
                    updateSchedule({ activeBranchId: event.target.value });
                    setSelectedId(null);
                    setChapterId(null);
                  }}
                >
                  <option value="main">Basisbegroting</option>
                  {calculated.schedule.branches
                    ?.filter((branch) => branch.id !== "main")
                    .map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                </select>
              )}
            </div>
            <div className="document-meta">
              <span>{calculated.schedule.client || "Geen opdrachtgever"}</span>
              <span className="meta-divider" />
              <span>
                {saved ? `Versie ${saved.revision}` : "Lokaal concept"}
              </span>
              <span className="save-state">
                {dirty ? (
                  <>
                    <span className="status-dot unsaved" />
                    Niet opgeslagen
                  </>
                ) : saved ? (
                  <>
                    <Check size={12} />
                    Opgeslagen
                  </>
                ) : (
                  <>
                    <CloudOff size={12} />
                    Voorbeeld
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="document-actions">
            <Tool
              label="Versiegeschiedenis"
              disabled={!saved || busy}
              onClick={loadVersions}
            >
              <History size={18} />
            </Tool>
            <Tool
              label="Afdrukken / PDF"
              onClick={() => {
                setTab("report");
                setTimeout(() => window.print(), 80);
              }}
            >
              <Printer size={18} />
            </Tool>
            <button
              className="primary-button"
              disabled={!user || busy || (!dirty && !!saved)}
              onClick={save}
            >
              {busy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Cloud size={16} />
              )}
              <span>Opslaan</span>
            </button>
          </div>
        </div>

        <nav className="document-tabs" aria-label="Begrotingsweergaven">
          {(
            [
              { id: "estimate", label: "Begroting", icon: LayoutList },
              { id: "tail", label: "Uren & staart", icon: Settings2 },
              { id: "report", label: "Rapport", icon: FileText },
              { id: "project", label: "Projectgegevens", icon: Building2 },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              aria-pressed={tab === id}
              key={id}
              onClick={() => setTab(id)}
              className={tab === id ? "active" : ""}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        {(error || notice) && (
          <div
            role={error ? "alert" : "status"}
            className={`notice ${error ? "error" : ""}`}
          >
            <span>{error || notice}</span>
            <Tool
              label="Melding sluiten"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X size={14} />
            </Tool>
          </div>
        )}
        {!user && authReady && (
          <div className="local-banner">
            <CloudOff size={14} />
            <span>Lokale werksessie</span>
            <a href="/signin-with-chatgpt?return_to=%2F" target="_top">
              Inloggen voor opslag in je werkruimte
              <ChevronRight size={13} />
            </a>
          </div>
        )}

        {tab === "estimate" && (
          <>
            <div className="grid-toolbar">
              <div className="toolbar-group">
                <button
                  className="text-tool"
                  onClick={() => addRow("begrotingspost")}
                >
                  <Plus size={16} />
                  Post toevoegen
                </button>
                <Tool
                  label="Hoofdstuk toevoegen"
                  onClick={() => addRow("chapter")}
                >
                  <FolderPlus size={17} />
                </Tool>
                <Tool label="Middel toevoegen" onClick={() => addRow("regel")}>
                  <Plus size={16} />
                </Tool>
                <span className="toolbar-divider" />
                <Tool
                  label="Ongedaan maken"
                  disabled={!undo.length}
                  onClick={() => stepHistory("undo")}
                >
                  <Undo2 size={16} />
                </Tool>
                <Tool
                  label="Opnieuw uitvoeren"
                  disabled={!redo.length}
                  onClick={() => stepHistory("redo")}
                >
                  <Redo2 size={16} />
                </Tool>
                <Tool
                  label="Geselecteerde regel verwijderen"
                  disabled={!selected}
                  onClick={deleteRow}
                >
                  <Trash2 size={16} />
                </Tool>
              </div>
              <div className="toolbar-group">
                <label className="search-field">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Zoeken in begroting"
                    aria-label="Zoeken in begroting"
                  />
                </label>
                <Tool
                  label="Bestand importeren"
                  onClick={() => fileInput.current?.click()}
                >
                  <ArrowUpFromLine size={17} />
                </Tool>
                <select
                  className="export-format"
                  aria-label="Exportformaat"
                  value={exportFormat}
                  onChange={(event) => setExportFormat(event.target.value)}
                >
                  <option value="ocs">.ocs</option>
                  <option value="ifcCalc">.ifcCalc</option>
                  <option value="calc">.calc</option>
                </select>
                <Tool label="Bestand exporteren" onClick={() => exportFile()}>
                  <ArrowDownToLine size={17} />
                </Tool>
                <Tool
                  label="Regeleigenschappen"
                  className={inspectorOpen ? "active" : ""}
                  onClick={() => setInspectorOpen(!inspectorOpen)}
                >
                  <Settings2 size={17} />
                </Tool>
              </div>
            </div>
            <div className="estimate-body">
              <div
                className="grid-scroll"
                ref={gridScroll}
                onFocusCapture={(event) =>
                  setFocusedRowId(
                    (event.target as HTMLElement).closest<HTMLTableRowElement>(
                      "tr[data-row-id]",
                    )?.dataset.rowId ?? null,
                  )
                }
                onBlurCapture={(event) => {
                  if (
                    !(event.relatedTarget as HTMLElement | null)?.closest(
                      "tr[data-row-id]",
                    )
                  )
                    setFocusedRowId(null);
                }}
              >
                <table
                  className="estimate-grid"
                  aria-rowcount={rows.length + 1}
                >
                  <colgroup>
                    <col className="col-num" />
                    <col className="col-code" />
                    <col className="col-description" />
                    <col className="col-quantity" />
                    <col className="col-unit" />
                    <col className="col-money" />
                    <col className="col-money" />
                    <col className="col-money" />
                    <col className="col-total" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="row-index">#</th>
                      <th>Code</th>
                      <th>Omschrijving</th>
                      <th className="numeric">Hoeveelheid</th>
                      <th>Eenh.</th>
                      <th className="numeric">Materiaal / prijs</th>
                      <th className="numeric">Loon / norm</th>
                      <th className="numeric">Eenheidsprijs</th>
                      <th className="numeric">Totaal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {virtualRows.entries.map(({ index, gapBefore }) => {
                      const item = rows[index];
                      const group = item.rowType === "chapter";
                      const text =
                        item.rowType === "tekstregel" ||
                        item.rowType === "witregel";
                      const hasChildren = childParents.has(item.id);
                      return (
                        <Fragment key={item.id}>
                          {gapBefore > 0 && (
                            <tr aria-hidden="true" className="virtual-spacer">
                              <td
                                colSpan={9}
                                style={{ height: gapBefore * GRID_ROW_HEIGHT }}
                              />
                            </tr>
                          )}
                          <tr
                            data-row-id={item.id}
                            aria-rowindex={index + 2}
                            className={`${group ? "chapter-row" : ""} ${selectedId === item.id ? "selected-row" : ""} ${text ? "text-row" : ""}`}
                            onClick={() => setSelectedId(item.id)}
                          >
                            <td className="row-index">{index + 1}</td>
                            <td>
                              <input
                                className="cell-input code-input"
                                aria-label={`Code: ${item.description}`}
                                value={item.code}
                                onChange={(event) =>
                                  updateItem(item.id, {
                                    code: event.target.value,
                                  })
                                }
                              />
                            </td>
                            <td>
                              <div
                                className="description-cell"
                                style={{
                                  paddingLeft: `${Math.min(item.depth, 8) * 16}px`,
                                }}
                              >
                                {hasChildren ? (
                                  <button
                                    className="collapse-toggle"
                                    aria-label={`${collapsed.has(item.id) ? "Uitklappen" : "Inklappen"}: ${item.description}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setCollapsed((current) => {
                                        const next = new Set(current);
                                        if (next.has(item.id))
                                          next.delete(item.id);
                                        else next.add(item.id);
                                        return next;
                                      });
                                    }}
                                  >
                                    {collapsed.has(item.id) ? (
                                      <ChevronRight size={14} />
                                    ) : (
                                      <ChevronDown size={14} />
                                    )}
                                  </button>
                                ) : (
                                  <span
                                    className={`row-type-dot ${item.rowType === "regel" ? "resource" : ""}`}
                                  />
                                )}
                                <input
                                  className="cell-input"
                                  aria-label={`Omschrijving regel ${index + 1}`}
                                  value={item.description}
                                  onChange={(event) =>
                                    updateItem(item.id, {
                                      description: event.target.value,
                                    })
                                  }
                                />
                                {item.wpcalcUncalculatedPrice === true && (
                                  <span
                                    className="source-warning"
                                    role="img"
                                    aria-label="Bronregel niet doorgerekend"
                                    title="Bronregel niet doorgerekend"
                                  >
                                    <CircleAlert size={14} />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              {!group &&
                                !text &&
                                numInput(item, "quantity", "Hoeveelheid")}
                            </td>
                            <td>
                              {!group && !text && (
                                <select
                                  className="cell-input"
                                  aria-label={`Eenheid: ${item.description}`}
                                  value={item.unit}
                                  onChange={(event) =>
                                    updateItem(item.id, {
                                      unit: event.target
                                        .value as CostItem["unit"],
                                    })
                                  }
                                >
                                  {[
                                    ...new Set([
                                      item.unit,
                                      "st",
                                      "m",
                                      "m²",
                                      "m³",
                                      "uur",
                                      "kg",
                                      "ton",
                                      "ls",
                                      "post",
                                      "dgn",
                                      "%",
                                      "pm",
                                    ]),
                                  ].map((unit) => (
                                    <option key={unit}>{unit}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td>
                              {!group &&
                                !text &&
                                !hasChildren &&
                                numInput(
                                  item,
                                  item.rowType === "regel"
                                    ? "normUnitPrice"
                                    : "materialPrice",
                                  "Prijs",
                                )}
                            </td>
                            <td>
                              {!group &&
                                !text &&
                                !hasChildren &&
                                numInput(
                                  item,
                                  item.rowType === "regel"
                                    ? "normQuantity"
                                    : "laborPrice",
                                  "Loon of norm",
                                )}
                            </td>
                            <td className="numeric amount">
                              {!group &&
                                !text &&
                                number(
                                  item.rowType === "regel"
                                    ? item.quantity
                                      ? item.total / item.quantity
                                      : 0
                                    : item.unitPrice,
                                )}
                            </td>
                            <td className="numeric total-amount">
                              {!text && number(item.total)}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    {virtualRows.bottomRows > 0 && (
                      <tr aria-hidden="true" className="virtual-spacer">
                        <td
                          colSpan={9}
                          style={{
                            height: virtualRows.bottomRows * GRID_ROW_HEIGHT,
                          }}
                        />
                      </tr>
                    )}
                  </tbody>
                </table>
                {rows.length === 0 && (
                  <div className="empty-grid">
                    <FileText size={25} />
                    <strong>
                      {query
                        ? "Geen overeenkomende regels"
                        : "Nog geen begrotingsregels"}
                    </strong>
                    <button
                      className="text-tool"
                      onClick={() => addRow("chapter")}
                    >
                      <FolderPlus size={16} />
                      Hoofdstuk toevoegen
                    </button>
                  </div>
                )}
                <button
                  className="add-bottom"
                  onClick={() => addRow("begrotingspost")}
                >
                  <Plus size={15} />
                  Begrotingspost toevoegen
                </button>
                <div className="grid-filler" />
              </div>
              {inspectorOpen && (
                <aside className="row-inspector">
                  <div className="panel-title">
                    <strong>Regeleigenschappen</strong>
                    <Tool
                      label="Eigenschappen sluiten"
                      onClick={() => setInspectorOpen(false)}
                    >
                      <X size={15} />
                    </Tool>
                  </div>
                  {selected ? (
                    <>
                      {selected.wpcalcUncalculatedPrice === true && (
                        <div className="source-state">
                          <strong>
                            <CircleAlert size={15} />
                            Bronregel niet doorgerekend
                          </strong>
                          <label>
                            Oorspronkelijke bronprijs
                            <input
                              aria-label="Oorspronkelijke bronprijs"
                              readOnly
                              value={money(
                                typeof selected.wpcalcOriginalPrice === "number"
                                  ? selected.wpcalcOriginalPrice
                                  : 0,
                              )}
                            />
                          </label>
                          <button
                            className="text-tool"
                            onClick={() =>
                              updateItem(selected.id, {
                                wpcalcUncalculatedPrice: false,
                                laborPrice:
                                  typeof selected.wpcalcOriginalLaborPrice ===
                                  "number"
                                    ? selected.wpcalcOriginalLaborPrice
                                    : 0,
                                tariefGroep: ["A", "B", "C"].includes(
                                  String(selected.wpcalcOriginalTariefGroep),
                                )
                                  ? (selected.wpcalcOriginalTariefGroep as CostItem["tariefGroep"])
                                  : null,
                                normUnitPrice:
                                  typeof selected.wpcalcOriginalPrice ===
                                  "number"
                                    ? selected.wpcalcOriginalPrice
                                    : 0,
                              })
                            }
                          >
                            Bronregel berekenen
                          </button>
                        </div>
                      )}
                      <label>
                        Regeltype
                        <select
                          value={selected.rowType}
                          disabled={isTail(selected)}
                          onChange={(event) =>
                            updateItem(selected.id, {
                              rowType: event.target.value as RowType,
                            })
                          }
                        >
                          {Object.entries(rowNames).map(([key, label]) => (
                            <option
                              key={key}
                              value={key}
                              disabled={
                                childParents.has(selected.id) &&
                                ![
                                  "chapter",
                                  "begrotingspost",
                                  "bewakingspost",
                                ].includes(key)
                              }
                            >
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selected.rowType === "regel" && (
                        <>
                          <label>
                            Middelsoort
                            <select
                              value={selected.resourceType ?? "overig"}
                              onChange={(event) =>
                                updateItem(selected.id, {
                                  resourceType: event.target
                                    .value as CostItem["resourceType"],
                                })
                              }
                            >
                              {[
                                "arbeid",
                                "materiaal",
                                "materieel",
                                "onderaannemer",
                                "overig",
                              ].map((type) => (
                                <option key={type}>{type}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Tariefgroep
                            <select
                              value={selected.tariefGroep ?? ""}
                              onChange={(event) =>
                                updateItem(selected.id, {
                                  tariefGroep: (event.target.value ||
                                    null) as CostItem["tariefGroep"],
                                })
                              }
                            >
                              <option value="">Geen</option>
                              {["A", "B", "C"].map((group) => (
                                <option key={group}>{group}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Loon per eenheid
                            <input
                              type="number"
                              step="any"
                              value={selected.laborPrice ?? ""}
                              disabled={
                                selected.wpcalcUncalculatedPrice === true ||
                                (!!selected.tariefGroep &&
                                  selected.normQuantity !== null)
                              }
                              aria-label={`Loon per eenheid: ${selected.description}`}
                              onChange={(event) =>
                                updateItem(selected.id, {
                                  laborPrice:
                                    event.target.value === ""
                                      ? null
                                      : Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          {(["normFactor"] as const).map((field) => (
                            <label key={field}>
                              {field === "normFactor"
                                ? "Normfactor"
                                : "Normdeler"}
                              {numInput(selected, field, field)}
                            </label>
                          ))}
                        </>
                      )}
                      <label>
                        Btw-tarief
                        <select
                          aria-label={`Btw-tarief: ${selected.description}`}
                          value={selected.btwTarief ?? ""}
                          onChange={(event) =>
                            updateItem(selected.id, {
                              btwTarief: (event.target.value ||
                                null) as CostItem["btwTarief"],
                            })
                          }
                        >
                          <option value="">Erven</option>
                          <option value="hoog">Hoog</option>
                          <option value="laag">Laag</option>
                        </select>
                      </label>
                      <label>
                        Notities
                        <textarea
                          value={selected.notes}
                          onChange={(event) =>
                            updateItem(selected.id, {
                              notes: event.target.value,
                            })
                          }
                          rows={5}
                        />
                      </label>
                      <div className="inspector-total">
                        <span>Regeltotaal</span>
                        <strong>{money(selected.total)}</strong>
                      </div>
                    </>
                  ) : (
                    <p className="muted">Geen regel geselecteerd</p>
                  )}
                </aside>
              )}
            </div>
            <div className="grid-footer">
              <span>
                {rows.length} regels{" "}
                <span className="footer-selected">
                  {selected
                    ? `· ${rowNames[selected.rowType] ?? "Opslag"} geselecteerd`
                    : ""}
                </span>
              </span>
              <span>{calculated.schedule.currency} · excl. btw</span>
            </div>
          </>
        )}

        {tab === "tail" && (
          <div className="settings-view">
            <section className="settings-section">
              <div className="section-heading">
                <h2>Uren & tarieven</h2>
                <span className="muted">{number(hours, 1)} uur</span>
              </div>
              <div className="rate-grid">
                {["A", "B", "C"].map((group) => (
                  <label key={group}>
                    <span>
                      <span className="rate-dot" />
                      Tariefgroep {group}
                    </span>
                    <div className="input-with-suffix">
                      <input
                        aria-label={`Uurtarief ${group}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={calculated.schedule.tarieven?.[group] ?? 0}
                        onChange={(event) =>
                          updateSchedule({
                            tarieven: {
                              ...calculated.schedule.tarieven,
                              [group]: Number(event.target.value),
                            },
                          })
                        }
                      />
                      <span>{calculated.schedule.currency} / uur</span>
                    </div>
                  </label>
                ))}
              </div>
            </section>
            <section className="settings-section">
              <div className="section-heading">
                <h2>Staartberekening</h2>
                <span className="muted">Cascaderende opslagen</span>
              </div>
              <table className="tail-table">
                <thead>
                  <tr>
                    <th>Omschrijving</th>
                    <th>Rekenbasis</th>
                    <th className="numeric">Percentage</th>
                    <th className="numeric">Bedrag</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Directe kosten</td>
                    <td />
                    <td />
                    <td className="numeric">{money(direct)}</td>
                  </tr>
                  {tails.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          aria-label={`Omschrijving opslag ${item.rowType}`}
                          value={item.description}
                          onChange={(event) =>
                            updateItem(item.id, {
                              description: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        {item.rowType === "staart_afronding" ? (
                          <div className="rounding-controls">
                            <select
                              aria-label="Afrondingsmethode"
                              value={
                                item.staartVastBedrag != null
                                  ? "fixed"
                                  : item.staartDoelbedrag != null
                                    ? "target"
                                    : item.staartAfrondingStap
                                      ? "step"
                                      : "none"
                              }
                              onChange={(event) =>
                                updateItem(item.id, {
                                  staartVastBedrag:
                                    event.target.value === "fixed" ? 0 : null,
                                  staartDoelbedrag:
                                    event.target.value === "target"
                                      ? exVat
                                      : null,
                                  staartAfrondingStap:
                                    event.target.value === "step" ? 10 : 0,
                                })
                              }
                            >
                              <option value="none">Geen afronding</option>
                              <option value="step">Afronden op stap</option>
                              <option value="target">
                                Doelbedrag excl. btw
                              </option>
                              <option value="fixed">
                                Vast afrondingsbedrag
                              </option>
                            </select>
                            {(item.staartVastBedrag != null ||
                              item.staartDoelbedrag != null ||
                              !!item.staartAfrondingStap) && (
                              <input
                                aria-label="Afrondingswaarde"
                                type="number"
                                step="0.01"
                                value={
                                  item.staartVastBedrag ??
                                  item.staartDoelbedrag ??
                                  item.staartAfrondingStap ??
                                  0
                                }
                                onChange={(event) =>
                                  updateItem(item.id, {
                                    [item.staartVastBedrag != null
                                      ? "staartVastBedrag"
                                      : item.staartDoelbedrag != null
                                        ? "staartDoelbedrag"
                                        : "staartAfrondingStap"]: Number(
                                      event.target.value,
                                    ),
                                  })
                                }
                              />
                            )}
                          </div>
                        ) : item.rowType === "staart_btw_laag" ? (
                          <input
                            aria-label="Grondslag laag btw-tarief"
                            type="number"
                            step="0.01"
                            min="0"
                            value={
                              computeBtwLaagDirect(calculationItems) > 0
                                ? (item.staartItemBreakdown?.bedrag ?? 0)
                                : (item.staartBtwBasis ?? 0)
                            }
                            disabled={
                              computeBtwLaagDirect(calculationItems) > 0
                            }
                            onChange={(event) =>
                              updateItem(item.id, {
                                staartBtwBasis: Number(event.target.value),
                              })
                            }
                          />
                        ) : item.rowType === "staart_btw" ? (
                          <span className="muted">Aanneemsom excl. btw</span>
                        ) : item.rowType === "staart_ak_oa" ? (
                          <span className="muted">Onderaanneming</span>
                        ) : (
                          <select
                            aria-label={`Rekenbasis: ${item.description}`}
                            value={item.staartBasis ?? "cumulatief"}
                            onChange={(event) =>
                              updateItem(item.id, {
                                staartBasis: event.target
                                  .value as CostItem["staartBasis"],
                              })
                            }
                          >
                            <option value="cumulatief">Cumulatief</option>
                            <option value="kostprijs">Directe kosten</option>
                          </select>
                        )}
                      </td>
                      <td className="numeric">
                        {item.rowType !== "staart_afronding" && (
                          <div className="percentage-input">
                            {numInput(item, "staartPercentage", "Percentage")}
                            <span>%</span>
                          </div>
                        )}
                      </td>
                      <td className="numeric">{money(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Totaal inclusief btw</th>
                    <td />
                    <td />
                    <th className="numeric">
                      {money(getGrandTotal(calculationItems))}
                    </th>
                  </tr>
                </tfoot>
              </table>
            </section>
          </div>
        )}

        {tab === "project" && (
          <div className="settings-view">
            <section className="settings-section">
              <div className="section-heading">
                <h2>Projectgegevens</h2>
                <Building2 size={18} />
              </div>
              <div className="project-form">
                {(
                  [
                    { key: "name", label: "Naam begroting" },
                    { key: "projectName", label: "Projectnaam" },
                    { key: "projectNumber", label: "Projectnummer" },
                    { key: "client", label: "Opdrachtgever" },
                    { key: "author", label: "Opgesteld door" },
                  ] as const
                ).map(({ key, label }) => (
                  <label key={key}>
                    {label}
                    <input
                      value={calculated.schedule[key]}
                      onChange={(event) =>
                        updateSchedule({ [key]: event.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  Status
                  <select
                    value={calculated.schedule.status}
                    onChange={(event) =>
                      updateSchedule({
                        status: event.target
                          .value as ProjectFile["schedule"]["status"],
                      })
                    }
                  >
                    <option value="DRAFT">Concept</option>
                    <option value="FINAL">Definitief</option>
                    <option value="REVISED">Herzien</option>
                  </select>
                </label>
                <label className="full-width">
                  Projectomschrijving
                  <textarea
                    rows={4}
                    value={calculated.schedule.description}
                    onChange={(event) =>
                      updateSchedule({ description: event.target.value })
                    }
                  />
                </label>
              </div>
            </section>
            <section className="settings-section">
              <div className="section-heading">
                <h2>Bestand & beheer</h2>
                <FileText size={18} />
              </div>
              <div className="file-actions">
                <button onClick={() => fileInput.current?.click()}>
                  <ArrowUpFromLine size={17} />
                  Importeren
                </button>
                <button onClick={() => exportFile("ocs")}>
                  <ArrowDownToLine size={17} />
                  Export .ocs
                </button>
                <button onClick={() => exportFile("ifcCalc")}>
                  <ArrowDownToLine size={17} />
                  Export .ifcCalc
                </button>
                <button onClick={duplicate}>
                  <Copy size={17} />
                  Dupliceren
                </button>
                {saved && (
                  <button
                    className="danger-text"
                    onClick={removeProject}
                    disabled={busy}
                  >
                    <Trash2 size={17} />
                    Verwijderen
                  </button>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === "report" && (
          <div className="report-view">
            <div className="report-toolbar">
              <span>Begrotingsrapport</span>
              <button className="text-tool" onClick={() => window.print()}>
                <Printer size={16} />
                Afdrukken / PDF
              </button>
            </div>
            <article className="report-page">
              <div className="report-brand">
                <Building2 size={22} />
                <strong>PeerCalc</strong>
                <span>BEGROTING</span>
              </div>
              <div className="report-heading">
                <div>
                  <p>{calculated.schedule.projectNumber}</p>
                  <h2>{calculated.schedule.name}</h2>
                  <p>{calculated.schedule.projectName}</p>
                </div>
                <div>
                  <strong>{calculated.schedule.client}</strong>
                  <p>{calculated.schedule.author}</p>
                  <p>{new Date().toLocaleDateString("nl-NL")}</p>
                </div>
              </div>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Omschrijving</th>
                    <th className="numeric">Aantal</th>
                    <th>Eenh.</th>
                    <th className="numeric">Prijs</th>
                    <th className="numeric">Bedrag</th>
                  </tr>
                </thead>
                <tbody>
                  {calculationItems
                    .filter((item) => !isTail(item))
                    .map((item) => (
                      <tr
                        key={item.id}
                        className={
                          item.rowType === "chapter" ? "report-chapter" : ""
                        }
                      >
                        <td>{item.code}</td>
                        <td
                          style={{
                            paddingLeft: `${Math.min(item.depth, 8) * 12 + 8}px`,
                          }}
                        >
                          {item.description}
                        </td>
                        <td className="numeric">
                          {item.quantity === null ? "" : number(item.quantity)}
                        </td>
                        <td>{item.quantity === null ? "" : item.unit}</td>
                        <td className="numeric">
                          {item.rowType === "chapter"
                            ? ""
                            : number(
                                item.rowType === "regel"
                                  ? item.quantity
                                    ? item.total / item.quantity
                                    : 0
                                  : item.unitPrice,
                              )}
                        </td>
                        <td className="numeric">
                          {!["tekstregel", "witregel"].includes(item.rowType) &&
                            number(item.total)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <div className="report-totals">
                <div>
                  <span>Directe kosten</span>
                  <strong>{money(direct)}</strong>
                </div>
                {tails.map((item) => (
                  <div key={item.id}>
                    <span>
                      {item.description}
                      {item.staartPercentage
                        ? ` (${number(item.staartPercentage)}%)`
                        : ""}
                    </span>
                    <span>{money(item.total)}</span>
                  </div>
                ))}
                <div className="report-grand-total">
                  <strong>Totaal inclusief btw</strong>
                  <strong>{money(getGrandTotal(calculationItems))}</strong>
                </div>
              </div>
              <footer>
                {calculated.schedule.name}
                <span>
                  {saved ? `Versie ${saved.revision}` : "Concept"} ·{" "}
                  {calculated.schedule.currency}
                </span>
              </footer>
            </article>
          </div>
        )}

        <footer className="cost-summary">
          <div className="summary-main">
            <span>Directe kosten</span>
            <strong>{money(direct)}</strong>
          </div>
          <div className="summary-detail">
            <span>
              <i className="legend labor" />
              Loon
            </span>
            <strong>{money(breakdown.loon)}</strong>
          </div>
          <div className="summary-detail">
            <span>
              <i className="legend material" />
              Materiaal
            </span>
            <strong>{money(breakdown.materiaal)}</strong>
          </div>
          <div className="summary-detail">
            <span>
              <i className="legend subcontract" />
              Onderaanneming
            </span>
            <strong>{money(breakdown.onderaanneming)}</strong>
          </div>
          <div className="summary-grand">
            <span>Aanneemsom excl. btw</span>
            <strong>{money(exVat)}</strong>
          </div>
        </footer>
      </section>
      <input
        ref={fileInput}
        type="file"
        accept=".ocs,.ifcCalc,.json,.calc"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.target.value = "";
        }}
      />

      {versions !== null && (
        <div className="modal-backdrop" onClick={() => setVersions(null)}>
          <section
            ref={dialogRef}
            className="versions-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Versiegeschiedenis"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-title">
              <div>
                <h2>Versiegeschiedenis</h2>
                <span>{saved?.name}</span>
              </div>
              <Tool
                label="Versiegeschiedenis sluiten"
                onClick={() => setVersions(null)}
              >
                <X size={18} />
              </Tool>
            </div>
            <div className="version-list">
              {versions.map((version) => (
                <div className="version-row" key={version.revision}>
                  <span className="version-icon">
                    <History size={17} />
                  </span>
                  <div>
                    <strong>
                      Versie {version.revision}
                      {version.revision === saved?.revision && (
                        <span className="current-label">Huidig</span>
                      )}
                    </strong>
                    <span>{date(version.createdAt)}</span>
                    <small>{version.message}</small>
                  </div>
                  <button
                    disabled={busy || version.revision === saved?.revision}
                    className="text-tool"
                    onClick={() => restoreVersion(version.revision)}
                  >
                    Herstellen
                  </button>
                </div>
              ))}
              {!versions.length && (
                <p className="muted">Geen versies beschikbaar.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

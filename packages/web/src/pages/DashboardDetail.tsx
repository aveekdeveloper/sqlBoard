import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import GridLayout from 'react-grid-layout';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Code2,
  Eye,
  GitBranch,
  History as HistoryIcon,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { api } from '../api/client.js';
import type { DashboardDetailDto, DashboardVersionSummary } from '../api/client.js';
import type { Layout } from '@sqlboard/shared';
import {
  BLOCK_META,
  appendItem,
  attachIds,
  blockKey,
  dashboardToDoc,
  normalizeLayout,
  parseDoc,
  relativeTime,
  serializeDoc,
  withItemAt,
  withLayouts,
  withoutItemAt,
  type DashboardBlockType,
  type DashboardDoc,
  type ManifestDiagnostic,
  type ManifestItem,
} from '../dashboard/model.js';
import { BlockCard } from '../dashboard/BlockCard.js';
import FilterBar from '../dashboard/FilterBar.js';
import type { FilterValue } from '../dashboard/filters.js';
import AddBlockMenu from '../dashboard/AddBlockMenu.js';
import BlockEditor from '../dashboard/BlockEditor.js';
import CodePanel from '../dashboard/CodePanel.js';
import CommitDialog from '../dashboard/CommitDialog.js';
import HistoryDialog from '../dashboard/HistoryDialog.js';
import { Button, Segmented, Toast, type ToastMessage } from '../dashboard/ui.js';

const Grid = GridLayout.WidthProvider(GridLayout);

const ROW_HEIGHT = 36;
const MOBILE_HEIGHT: Record<DashboardBlockType, number> = {
  chart: 300,
  metric: 150,
  table: 360,
  text: 220,
};

interface GridEntry {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

interface StoredDraft {
  code: string;
  savedAt: string;
}

type ToastTone = 'success' | 'error' | 'info';
type Mode = 'view' | 'edit';
type CommitKind = 'apply' | 'manual';

function draftKeyFor(id: number): string {
  return `sqlboard:dashboard-draft:${id}`;
}

function readDraft(key: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    return typeof parsed.code === 'string' ? { code: parsed.code, savedAt: parsed.savedAt ?? '' } : null;
  } catch {
    return null;
  }
}

function contentSignature(doc: DashboardDoc | null): string {
  if (!doc) return '';
  return JSON.stringify({
    name: doc.name,
    description: doc.description,
    items: doc.items.map((item) => ({
      title: item.title,
      sql: item.sql,
      connectionId: item.connectionId,
      blockType: item.blockType,
      config: item.config,
    })),
  });
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

function toGridLayouts(items: ManifestItem[]): GridEntry[] {
  return items.map((item, index) => {
    const meta = BLOCK_META[item.blockType];
    const layout = normalizeLayout(item.layout);
    return {
      i: blockKey(index),
      x: layout.x,
      y: layout.y,
      w: Math.max(meta.minW, layout.w),
      h: Math.max(meta.minH, layout.h),
      minW: meta.minW,
      minH: meta.minH,
    };
  });
}

function blankDoc(name = 'Dashboard'): DashboardDoc {
  return { name, description: null, filters: [], items: [] };
}

export default function DashboardDetail() {
  const params = useParams();
  const dashboardId = Number(params.id);
  const validId = Number.isFinite(dashboardId) && dashboardId > 0;
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const draftKey = draftKeyFor(dashboardId);

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', dashboardId],
    queryFn: () => api.dashboards.get(dashboardId),
    enabled: validId,
  });
  const connectionsQuery = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.connections.list(),
    staleTime: 60_000,
  });
  const savedQueriesQuery = useQuery({
    queryKey: ['saved-queries'],
    queryFn: () => api.savedQueries.list(),
    staleTime: 60_000,
  });

  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const manifestConnections = useMemo(
    () => connections.map((connection) => ({ id: connection.id, name: connection.name })),
    [connections],
  );
  const manifestSavedQueries = useMemo(
    () => (savedQueriesQuery.data ?? []).map((query: any) => ({
      id: query.id,
      name: query.name,
      sql: query.sql,
      connectionId: query.connectionId,
    })),
    [savedQueriesQuery.data],
  );

  const dashboard = dashboardQuery.data;
  const serverDoc = useMemo(() => (dashboard ? dashboardToDoc(dashboard) : null), [dashboard]);
  const appliedCode = useMemo(
    () => (serverDoc ? serializeDoc(serverDoc, manifestConnections, manifestSavedQueries) : ''),
    [serverDoc, manifestConnections, manifestSavedQueries],
  );

  const [code, setCode] = useState('');
  const [ready, setReady] = useState(false);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    initRef.current = false;
    setReady(false);
    setCode('');
    setRestoredAt(null);
  }, [dashboardId]);

  useEffect(() => {
    if (initRef.current) return;
    if (!serverDoc || !connectionsQuery.data) return;
    initRef.current = true;
    const canonical = serializeDoc(serverDoc, manifestConnections, manifestSavedQueries);
    const stored = readDraft(draftKey);
    if (stored && stored.code.trim().length > 0 && stored.code.trim() !== canonical.trim()) {
      setCode(stored.code);
      setRestoredAt(stored.savedAt);
    } else {
      setCode(canonical);
    }
    setReady(true);
  }, [serverDoc, connectionsQuery.data, manifestConnections, draftKey]);

  const parsed = useMemo(() => {
    try {
      const result = parseDoc(code, manifestConnections, manifestSavedQueries);
      return { doc: result.doc, diagnostics: result.diagnostics };
    } catch (error) {
      const diagnostic: ManifestDiagnostic = {
        severity: 'error',
        code: 'PARSE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
      return { doc: blankDoc(), diagnostics: [diagnostic] };
    }
  }, [code, manifestConnections, manifestSavedQueries]);

  const doc = parsed.doc;
  const diagnostics = parsed.diagnostics;
  const errors = useMemo(
    () => diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    [diagnostics],
  );

  const dirty = useMemo(
    () => Boolean(serverDoc) && ready && contentSignature(doc) !== contentSignature(serverDoc),
    [serverDoc, ready, doc],
  );

  const latestVersion = dashboard?.latestVersion ?? 0;
  const blockCount = doc.items.length;

  useEffect(() => {
    if (!ready || !serverDoc) return;
    const timer = window.setTimeout(() => {
      try {
        if (code.trim() === appliedCode.trim()) {
          localStorage.removeItem(draftKey);
        } else {
          localStorage.setItem(
            draftKey,
            JSON.stringify({ code, savedAt: new Date().toISOString() } satisfies StoredDraft),
          );
        }
      } catch {
        // Storage can be unavailable in private mode; the draft still lives in memory.
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [code, ready, serverDoc, appliedCode, draftKey]);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string, tone: ToastTone = 'success') => {
    setToast({ id: Date.now(), text, tone });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const [mode, setMode] = useState<Mode>('view');
  const [filterValues, setFilterValues] = useState<Record<string, FilterValue>>({});
  const [codeOpen, setCodeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editorType, setEditorType] = useState<DashboardBlockType>('chart');

  const [applying, setApplying] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);

  const versionsQuery = useQuery({
    queryKey: ['dashboard-versions', dashboardId],
    queryFn: () => api.dashboards.listVersions(dashboardId),
    enabled: validId && historyOpen,
    staleTime: 10_000,
  });

  const adoptDashboard = useCallback(
    (next: DashboardDetailDto, message: string, tone: ToastTone = 'success') => {
      queryClient.setQueryData(['dashboard', dashboardId], next);
      const nextDoc = dashboardToDoc(next);
      setCode(serializeDoc(nextDoc, manifestConnections, manifestSavedQueries));
      setRestoredAt(null);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore storage failures
      }
      void queryClient.invalidateQueries({ queryKey: ['dashboard-versions', dashboardId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      notify(message, tone);
    },
    [queryClient, dashboardId, manifestConnections, draftKey, notify],
  );

  const applyCode = useCallback(
    async (kind: CommitKind = 'apply', message?: string) => {
      if (!serverDoc) return;
      if (errors.length > 0) {
        notify('Fix the manifest errors before applying.', 'error');
        setCodeOpen(true);
        return;
      }
      if (!doc.name.trim()) {
        notify('Give the dashboard a name before applying.', 'error');
        setCodeOpen(true);
        return;
      }

      setApplying(true);
      try {
        const items = doc.items.map((item) => ({
          title: item.title.trim() || 'Untitled block',
          sql: item.sql,
          connectionId: item.blockType === 'text' ? 0 : item.connectionId,
          savedQueryId: item.blockType === 'text' ? null : item.savedQueryId ?? null,
          blockType: item.blockType,
          config: item.config ?? undefined,
          layout: normalizeLayout(item.layout),
        }));
        const response = await api.dashboards.applyState(dashboardId, {
          name: doc.name.trim(),
          description: doc.description,
          filters: (doc.filters ?? []) as any,
          items,
          message: message ?? (kind === 'manual' ? `Commit ${doc.name}` : 'Apply dashboard code'),
          kind,
        });
        adoptDashboard(
          response,
          kind === 'manual'
            ? `Committed as v${response.version.version}`
            : `Applied as v${response.version.version}`,
        );
        setCommitOpen(false);
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        setApplying(false);
      }
    },
    [serverDoc, errors.length, doc, dashboardId, adoptDashboard, notify],
  );

  const commit = useCallback(
    async (message: string) => {
      if (errors.length > 0) {
        notify('Fix the manifest errors before committing.', 'error');
        setCodeOpen(true);
        return;
      }
      setCommitting(true);
      try {
        if (dirty) {
          await applyCode('manual', message);
          return;
        }
        const version = await api.dashboards.commitVersion(dashboardId, message);
        queryClient.setQueryData<DashboardDetailDto>(['dashboard', dashboardId], (current) =>
          current ? { ...current, latestVersion: version.version } : current,
        );
        void queryClient.invalidateQueries({ queryKey: ['dashboard-versions', dashboardId] });
        void queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        setCommitOpen(false);
        notify(`Committed as v${version.version}`);
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        setCommitting(false);
      }
    },
    [errors.length, dirty, applyCode, queryClient, dashboardId, notify],
  );

  const restore = useCallback(
    async (version: number) => {
      setRestoring(true);
      try {
        const response = await api.dashboards.restoreVersion(dashboardId, version);
        adoptDashboard(
          response,
          `Restored v${version} as v${response.version.version}`,
        );
        setHistoryOpen(false);
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        setRestoring(false);
      }
    },
    [adoptDashboard, dashboardId, notify],
  );

  const persistLayout = useCallback(
    async (next: GridEntry[]) => {
      if (!serverDoc || !ready) return;
      const layouts: Record<string, Layout> = {};
      for (const entry of next) {
        layouts[entry.i] = normalizeLayout({
          x: entry.x,
          y: entry.y,
          w: entry.w,
          h: entry.h,
        });
      }
      const nextDoc = withLayouts(doc, layouts);
      setCode(serializeDoc(nextDoc, manifestConnections, manifestSavedQueries));

      const withIds = attachIds(nextDoc.items, serverDoc.items);
      const updates = withIds.flatMap((item) =>
        item.id === undefined ? [] : [{ id: item.id, layout: item.layout }],
      );
      if (updates.length === 0) return;

      setSavingLayout(true);
      try {
        const response = await api.dashboards.saveLayout(dashboardId, updates);
        queryClient.setQueryData(['dashboard', dashboardId], response);
      } catch (error) {
        notify(
          `Layout could not be saved: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
      } finally {
        setSavingLayout(false);
      }
    },
    [serverDoc, ready, doc, manifestConnections, dashboardId, queryClient, notify],
  );

  const formatManifest = useCallback(() => {
    if (errors.length > 0) {
      notify('Fix the manifest errors before formatting.', 'error');
      return;
    }
    setCode(serializeDoc(doc, manifestConnections, manifestSavedQueries));
    notify('Manifest formatted', 'info');
  }, [errors.length, doc, manifestConnections, notify]);

  const discardDraft = useCallback(() => {
    setCode(appliedCode);
    setRestoredAt(null);
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore storage failures
    }
    notify('Draft discarded', 'info');
  }, [appliedCode, draftKey, notify]);

  const openAdd = useCallback(
    (type: DashboardBlockType) => {
      if (type !== 'text' && connections.length === 0) {
        notify('Add a connection before creating query blocks.', 'error');
        return;
      }
      setEditingIndex(null);
      setEditorType(type);
      setEditorOpen(true);
      setMode('edit');
    },
    [connections.length, notify],
  );

  const openEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setEditorOpen(true);
    setMode('edit');
  }, []);

  const saveBlock = useCallback(
    (item: ManifestItem) => {
      const nextDoc =
        editingIndex === null ? appendItem(doc, item) : withItemAt(doc, editingIndex, item);
      setCode(serializeDoc(nextDoc, manifestConnections, manifestSavedQueries));
      setEditorOpen(false);
      notify(
        editingIndex === null
          ? `"${item.title}" added to the draft`
          : `"${item.title}" updated in the draft`,
        'info',
      );
    },
    [editingIndex, doc, manifestConnections, notify],
  );

  const removeBlock = useCallback(
    (index: number) => {
      const item = doc.items[index];
      if (!item) return;
      if (!window.confirm(`Remove "${item.title}" from the draft?`)) return;
      setCode(serializeDoc(withoutItemAt(doc, index), manifestConnections, manifestSavedQueries));
      notify(`"${item.title}" removed from the draft`, 'info');
    },
    [doc, manifestConnections, notify],
  );

  const loadVersionCode = useCallback(
    (nextCode: string) => {
      setCode(nextCode);
      setHistoryOpen(false);
      setCodeOpen(true);
      notify('Version loaded into the code editor', 'info');
    },
    [notify],
  );

  const gridLayouts = useMemo(() => toGridLayouts(doc.items), [doc.items]);
  const editing = isDesktop && mode === 'edit';
  const canArrange = editing && errors.length === 0;
  const mobileItems = useMemo(
    () =>
      doc.items
        .map((item, index) => ({ item, index }))
        .sort(
          (left, right) =>
            left.item.layout.y - right.item.layout.y ||
            left.item.layout.x - right.item.layout.x,
        ),
    [doc.items],
  );

  if (!validId) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center">
          <div className="text-[15px] font-semibold text-ink">Dashboard not found</div>
          <Link
            to="/dashboards"
            className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
          >
            <ArrowLeft size={13} /> Back to dashboards
          </Link>
        </div>
      </div>
    );
  }

  if (dashboardQuery.isLoading || !ready) {
    return <DashboardSkeleton />;
  }

  if (dashboardQuery.isError || !dashboard) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-signal-soft text-signal">
            <AlertTriangle size={18} />
          </div>
          <div className="mt-3 text-[15px] font-semibold text-ink">Could not load dashboard</div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            {dashboardQuery.error instanceof Error
              ? dashboardQuery.error.message
              : 'The dashboard request failed.'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button variant="secondary" onClick={() => void dashboardQuery.refetch()}>
              Retry
            </Button>
            <Link
              to="/dashboards"
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium text-ink-muted hover:text-ink"
            >
              <ArrowLeft size={13} /> Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-paper">
      <header className="relative z-20 shrink-0 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex items-center gap-2.5 px-3 py-2.5 md:gap-3 md:px-5 md:py-3">
          <Link
            to="/dashboards"
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-[#f1eee7] hover:text-ink"
            aria-label="Back to dashboards"
          >
            <ArrowLeft size={16} strokeWidth={1.9} />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-[14.5px] font-semibold tracking-[-0.015em] text-ink md:text-[16px]">
                {doc.name || 'Untitled dashboard'}
              </h1>
              {dirty && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fbf3e5] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-warning">
                  <span className="h-1 w-1 rounded-full bg-warning" />
                  Draft
                </span>
              )}
              <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#f1eee7] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-muted sm:inline-flex">
                {latestVersion > 0 ? `v${latestVersion}` : 'No version'}
              </span>
              {savingLayout && (
                <span className="hidden items-center gap-1 text-[9.5px] text-ink-faint sm:inline-flex">
                  <Loader2 size={10} className="animate-spin" /> saving layout
                </span>
              )}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-ink-muted md:text-[10.5px]">
              {doc.description && (
                <>
                  <span className="truncate">{doc.description}</span>
                  <span className="text-ink-faint">·</span>
                </>
              )}
              <span className="shrink-0 tabular">
                {blockCount} block{blockCount === 1 ? '' : 's'}
              </span>
              <span className="hidden text-ink-faint sm:inline">·</span>
              <span className="hidden shrink-0 sm:inline">
                updated {relativeTime(dashboard.updatedAt)}
              </span>
              <span className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.08em] text-ink-faint md:hidden">
                Read-only
              </span>
            </div>
          </div>

          <div className="hidden items-center gap-1.5 md:flex">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'view', label: 'View', icon: <Eye size={12} /> },
                { value: 'edit', label: 'Edit', icon: <Pencil size={12} /> },
              ]}
            />
            <span className="mx-0.5 h-5 w-px bg-line" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHistoryOpen(true)}
              title="Version history"
            >
              <HistoryIcon size={13} />
              <span className="hidden lg:inline">History</span>
            </Button>
            <Button
              variant={codeOpen ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setCodeOpen((current) => !current)}
              title="Dashboard code"
            >
              <Code2 size={13} />
              <span className="hidden lg:inline">Code</span>
            </Button>
            {editing && <AddBlockMenu onSelect={openAdd} />}
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCommitOpen(true)}
              disabled={committing || applying}
              title="Commit a version"
            >
              {committing ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />}
              <span className="hidden sm:inline">{dirty ? 'Commit draft' : 'Commit'}</span>
            </Button>
          </div>

          <div className="flex items-center gap-1 md:hidden">
            <span className="rounded-full bg-[#f1eee7] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              {latestVersion > 0 ? `v${latestVersion}` : 'Read-only'}
            </span>
          </div>
        </div>

        {restoredAt && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#ecd9b6] bg-[#fbf3e5] px-3 py-1.5 text-[10.5px] text-warning md:px-5">
            <RotateCcw size={11} strokeWidth={2} />
            <span className="min-w-0">
              Unsaved draft restored{restoredAt ? ` from ${new Date(restoredAt).toLocaleString()}` : ''}.
            </span>
            <button
              type="button"
              onClick={discardDraft}
              className="font-medium underline decoration-warning/40 underline-offset-2 hover:decoration-warning"
            >
              Discard draft
            </button>
            <button
              type="button"
              onClick={() => setRestoredAt(null)}
              className="ml-auto text-ink-muted hover:text-ink"
            >
              Keep editing
            </button>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1600px] px-3 py-3 md:px-5 md:py-5">
            {!isDesktop && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[10.5px] leading-snug text-ink-muted">
                <LayoutGrid size={13} className="shrink-0 text-ink-faint" />
                Mobile view is read-only. Blocks are stacked in reading order; open on a desktop to
                rearrange them.
              </div>
            )}

            {errors.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-signal/25 bg-signal-soft px-3 py-2 text-[10.5px] leading-snug text-signal">
                <AlertTriangle size={13} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  {errors.length} manifest error{errors.length === 1 ? '' : 's'}:{' '}
                  <span className="text-signal/85">{errors[0]?.message}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setCodeOpen(true)}
                  className="font-medium underline decoration-signal/40 underline-offset-2 hover:decoration-signal"
                >
                  Open code
                </button>
              </div>
            )}

            {doc.items.length === 0 ? (
              <EmptyDashboard
                canEdit={isDesktop}
                onAdd={() => openAdd('chart')}
                onCode={() => setCodeOpen(true)}
              />
            ) : isDesktop ? (
              <>
                {doc.filters?.length ? (
                  <div className="mb-3">
                    <FilterBar
                      filters={doc.filters}
                      values={filterValues}
                      onChange={(name, value) => setFilterValues((current) => ({ ...current, [name]: value }))}
                      onClearAll={() => setFilterValues({})}
                    />
                  </div>
                ) : null}
                <div className={`grid-surface ${editing ? 'is-editing' : ''}`}>
                <Grid
                  className="layout"
                  layout={gridLayouts}
                  cols={12}
                  rowHeight={ROW_HEIGHT}
                  margin={[12, 12]}
                  containerPadding={[0, 0]}
                  isDraggable={canArrange}
                  isResizable={canArrange}
                  draggableHandle=".block-drag-handle"
                  compactType="vertical"
                  preventCollision={false}
                  useCSSTransforms
                  onDragStop={(layout) => void persistLayout(layout)}
                  onResizeStop={(layout) => void persistLayout(layout)}
                >
                  {doc.items.map((item, index) => (
                    <div key={blockKey(index)}>
                      <BlockCard
                        item={item}
                        editing={editing}
                        draggable={canArrange}
                        connections={connections}
                        filters={doc.filters}
                        filterValues={filterValues}
                        onEdit={() => openEdit(index)}
                        onDelete={() => removeBlock(index)}
                      />
                    </div>
                  ))}
                </Grid>
                {canArrange && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10px] text-ink-faint">
                    <span>Drag the handle to move</span>
                    <span>·</span>
                    <span>Resize from any edge</span>
                    <span>·</span>
                    <span>Layout saves instantly and does not create a version</span>
                  </div>
                )}
              </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                {doc.filters?.length ? (
                  <FilterBar
                    filters={doc.filters}
                    values={filterValues}
                    onChange={(name, value) => setFilterValues((current) => ({ ...current, [name]: value }))}
                  />
                ) : null}
                {mobileItems.map(({ item, index }) => (
                  <div key={`${item.title}-${index}`} style={{ height: MOBILE_HEIGHT[item.blockType] }}>
                    <BlockCard
                      item={item}
                      editing={false}
                      connections={connections}
                      filters={doc.filters}
                      filterValues={filterValues}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>

        <CodePanel
          open={codeOpen}
          code={code}
          diagnostics={diagnostics}
          dirty={dirty}
          applying={applying}
          onChange={setCode}
          onClose={() => setCodeOpen(false)}
          onApply={() => void applyCode('apply')}
          onFormat={formatManifest}
          onNotify={(message) => notify(message, 'info')}
        />
      </div>

      <BlockEditor
        open={editorOpen}
        initial={editingIndex === null ? null : doc.items[editingIndex] ?? null}
        defaultType={editorType}
        doc={doc}
        connections={connections}
        savedQueries={manifestSavedQueries}
        onClose={() => setEditorOpen(false)}
        onSave={saveBlock}
      />

      <CommitDialog
        open={commitOpen}
        onClose={() => setCommitOpen(false)}
        onCommit={(message) => void commit(message)}
        committing={committing || applying}
        dashboardName={doc.name || 'dashboard'}
        baseCode={appliedCode}
        code={code}
        dirty={dirty}
        latestVersion={latestVersion}
      />

      <HistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        versions={(versionsQuery.data ?? []) as DashboardVersionSummary[]}
        loading={versionsQuery.isLoading}
        restoring={restoring}
        onRestore={(version) => void restore(version)}
        onLoadCode={loadVersionCode}
        onNotify={(message) => notify(message, 'info')}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

function EmptyDashboard({
  canEdit,
  onAdd,
  onCode,
}: {
  canEdit: boolean;
  onAdd: () => void;
  onCode: () => void;
}) {
  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <div className="max-w-md rounded-xl border border-dashed border-line-strong bg-surface/60 px-8 py-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f1eee7] text-ink-soft">
          <LayoutGrid size={20} strokeWidth={1.6} />
        </div>
        <h2 className="mt-4 text-[16px] font-semibold tracking-[-0.015em] text-ink">
          A blank canvas
        </h2>
        <p className="mx-auto mt-1.5 max-w-xs text-[12px] leading-relaxed text-ink-muted">
          Add a chart, metric, table, or markdown note. Everything you build stays in a draft until
          you commit it.
        </p>
        {canEdit ? (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" onClick={onAdd}>
              <Plus size={13} /> Add first block
            </Button>
            <Button variant="secondary" onClick={onCode}>
              <Code2 size={13} /> Write code
            </Button>
          </div>
        ) : (
          <div className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#f1eee7] px-3 py-1.5 text-[10.5px] font-medium text-ink-muted">
            <Check size={12} /> Read-only on this device
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-paper">
      <div className="flex h-[61px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4 md:px-5">
        <div className="skeleton h-7 w-7 rounded-md" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="skeleton h-3.5 w-48" />
          <div className="skeleton h-2 w-64 opacity-70" />
        </div>
        <div className="hidden gap-1.5 md:flex">
          <div className="skeleton h-8 w-24 rounded-md" />
          <div className="skeleton h-8 w-20 rounded-md" />
          <div className="skeleton h-8 w-20 rounded-md" />
        </div>
      </div>
      <div className="grid flex-1 grid-cols-12 gap-3 px-5 py-5">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className={`skeleton rounded-xl ${index === 0 || index === 3 ? 'col-span-6' : 'col-span-3'}`}
            style={{ height: index === 0 || index === 3 ? 260 : 180 }}
          />
        ))}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { diffLines, type Change } from 'diff';
import {
  Check,
  Clipboard,
  GitBranch,
  GitCommitVertical,
  Loader2,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import type { DashboardVersionSummary } from '../api/client.js';
import { absoluteTime, relativeTime } from './model.js';
import { Button, Dialog } from './ui.js';

interface DiffLine {
  kind: 'add' | 'remove' | 'context';
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
}

function buildDiff(before: string, after: string): { lines: DiffLine[]; added: number; removed: number } {
  const parts: Change[] = diffLines(before, after);
  const lines: DiffLine[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  let added = 0;
  let removed = 0;

  for (const part of parts) {
    const content = part.value.split('\n');
    if (content[content.length - 1] === '') content.pop();
    for (const line of content) {
      if (part.added) {
        added += 1;
        lines.push({ kind: 'add', text: line, oldNumber: null, newNumber });
        newNumber += 1;
      } else if (part.removed) {
        removed += 1;
        lines.push({ kind: 'remove', text: line, oldNumber, newNumber: null });
        oldNumber += 1;
      } else {
        lines.push({ kind: 'context', text: line, oldNumber, newNumber });
        oldNumber += 1;
        newNumber += 1;
      }
    }
  }

  return { lines, added, removed };
}

const KIND_META = {
  manual: { label: 'Commit', icon: GitCommitVertical, tone: 'text-ink-muted' },
  apply: { label: 'Apply', icon: Play, tone: 'text-accent' },
  restore: { label: 'Restore', icon: RotateCcw, tone: 'text-warning' },
} as const;

export default function HistoryDialog({
  open,
  onClose,
  versions,
  loading,
  restoring,
  onRestore,
  onLoadCode,
  onNotify,
}: {
  open: boolean;
  onClose: () => void;
  versions: DashboardVersionSummary[];
  loading: boolean;
  restoring: boolean;
  onRestore: (version: number) => void;
  onLoadCode: (code: string) => void;
  onNotify: (message: string) => void;
}) {
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedVersion(versions[0]?.version ?? null);
    setConfirmVersion(null);
  }, [open, versions]);

  const selected = useMemo(
    () => versions.find((version) => version.version === selectedVersion) ?? versions[0] ?? null,
    [versions, selectedVersion],
  );
  const parent = useMemo(() => {
    if (!selected) return null;
    if (selected.parentVersion !== null) {
      return versions.find((version) => version.version === selected.parentVersion) ?? null;
    }
    return [...versions]
      .filter((version) => version.version < selected.version)
      .sort((left, right) => right.version - left.version)[0] ?? null;
  }, [selected, versions]);

  const diff = useMemo(
    () => (selected ? buildDiff(parent?.codeText ?? '', selected.codeText) : null),
    [selected, parent],
  );

  const tooLarge = diff !== null && diff.lines.length > 1500;
  const visibleLines = diff?.lines.slice(0, 1500) ?? [];

  async function copyVersion() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.codeText);
      onNotify(`Copied v${selected.version} manifest`);
    } catch {
      onNotify('Could not access the clipboard');
    }
  }

  const confirmTarget = versions.find((version) => version.version === confirmVersion) ?? null;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Dashboard history"
        description="Every apply, manual commit, and restore is a version. Layout changes alone do not create a version."
        width="max-w-6xl"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {selected && (
              <Button variant="secondary" onClick={() => onLoadCode(selected.codeText)}>
                Load v{selected.version} into editor
              </Button>
            )}
          </>
        }
      >
        {loading ? (
          <div className="flex h-[55vh] items-center justify-center gap-2 text-[12px] text-ink-muted">
            <Loader2 size={14} className="animate-spin" /> Loading history…
          </div>
        ) : versions.length === 0 ? (
          <div className="flex h-[55vh] flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f1eee7] text-ink-faint">
              <GitBranch size={17} />
            </div>
            <div className="text-[13px] font-medium text-ink">No versions yet</div>
            <p className="max-w-xs text-[11.5px] leading-relaxed text-ink-muted">
              Commit the current dashboard to start its history. Each commit captures the full
              SQL-first manifest.
            </p>
          </div>
        ) : (
          <div className="grid h-[62vh] min-h-[420px] grid-cols-1 gap-0 overflow-hidden rounded-lg border border-line md:grid-cols-[248px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col border-b border-line md:border-b-0 md:border-r">
              <div className="flex shrink-0 items-center justify-between border-b border-line bg-[#fbf9f4] px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                  Versions
                </span>
                <span className="tabular text-[10px] text-ink-faint">{versions.length}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-1.5">
                {versions.map((version) => {
                  const meta = KIND_META[version.kind];
                  const Icon = meta.icon;
                  const active = version.version === selected?.version;
                  return (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() => setSelectedVersion(version.version)}
                      className={`mb-0.5 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                        active ? 'bg-accent-soft/70' : 'hover:bg-[#f4f1ea]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                          active
                            ? 'border-accent/30 bg-surface text-accent'
                            : 'border-line bg-surface text-ink-faint'
                        }`}
                      >
                        <Icon size={11} strokeWidth={1.9} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="tabular text-[11px] font-semibold text-ink">
                            v{version.version}
                          </span>
                          <span className={`text-[9px] uppercase tracking-[0.08em] ${meta.tone}`}>
                            {meta.label}
                          </span>
                          {version.version === versions[0].version && (
                            <span className="ml-auto rounded-full bg-[#f1eee7] px-1.5 py-[1px] text-[8.5px] uppercase tracking-[0.08em] text-ink-faint">
                              Latest
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-ink-soft">
                          {version.message || 'No message'}
                        </span>
                        <span
                          className="mt-0.5 block text-[9.5px] text-ink-faint"
                          title={absoluteTime(version.createdAt)}
                        >
                          {relativeTime(version.createdAt)}
                          {version.authorId !== null ? ` · user ${version.authorId}` : ' · system'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex min-h-0 flex-col bg-[#fdfbf6]">
              {selected && diff ? (
                <>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="tabular text-[12px] font-semibold text-ink">
                          v{selected.version}
                        </span>
                        <span className="truncate text-[11.5px] text-ink-soft">
                          {selected.message || 'No message'}
                        </span>
                      </div>
                      <div className="text-[9.5px] text-ink-faint">
                        {parent ? `Diff against v${parent.version}` : 'Initial version'} ·{' '}
                        {absoluteTime(selected.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="tabular rounded bg-accent-soft px-1.5 py-0.5 text-accent-ink">
                        +{diff.added}
                      </span>
                      <span className="tabular rounded bg-signal-soft px-1.5 py-0.5 text-signal">
                        −{diff.removed}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={copyVersion}
                        className="focus-ring flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-ink-faint transition-colors hover:text-ink"
                        title="Copy this version"
                      >
                        <Clipboard size={12} />
                      </button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmVersion(selected.version)}
                        disabled={restoring}
                      >
                        <RotateCcw size={11} />
                        Restore
                      </Button>
                    </div>
                  </div>

                  {diff.lines.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                      <Check size={16} className="text-positive" />
                      <div className="text-[12px] text-ink-muted">
                        No manifest changes in this version.
                      </div>
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-auto">
                      <div className="min-w-max py-1 font-mono text-[11px] leading-[1.6]">
                        {visibleLines.map((line, index) => (
                          <div
                            key={index}
                            className={`flex ${
                              line.kind === 'add'
                                ? 'bg-[#eaf3ec]'
                                : line.kind === 'remove'
                                  ? 'bg-[#fbebe8]'
                                  : ''
                            }`}
                          >
                            <span className="w-10 shrink-0 select-none pr-2 text-right tabular text-ink-faint/70">
                              {line.oldNumber ?? ''}
                            </span>
                            <span className="w-10 shrink-0 select-none pr-2 text-right tabular text-ink-faint/70">
                              {line.newNumber ?? ''}
                            </span>
                            <span
                              className={`w-4 shrink-0 select-none text-center ${
                                line.kind === 'add'
                                  ? 'text-positive'
                                  : line.kind === 'remove'
                                    ? 'text-signal'
                                    : 'text-ink-faint'
                              }`}
                            >
                              {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
                            </span>
                            <span
                              className={`whitespace-pre pr-4 ${
                                line.kind === 'add'
                                  ? 'text-accent-ink'
                                  : line.kind === 'remove'
                                    ? 'text-signal'
                                    : 'text-ink-soft'
                              }`}
                            >
                              {line.text || ' '}
                            </span>
                          </div>
                        ))}
                        {tooLarge && (
                          <div className="px-4 py-3 text-[10.5px] text-ink-faint">
                            Diff truncated at 1,500 lines.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-[12px] text-ink-faint">
                  Select a version to inspect it.
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmTarget !== null}
        onClose={() => setConfirmVersion(null)}
        title={`Restore v${confirmTarget?.version ?? ''}?`}
        description="Restoring writes the old manifest over the current dashboard and creates a new restore version. Existing history is kept."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmVersion(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={restoring || confirmTarget === null}
              onClick={() => {
                if (confirmTarget) onRestore(confirmTarget.version);
              }}
            >
              {restoring && <Loader2 size={12} className="animate-spin" />}
              {restoring ? 'Restoring…' : 'Restore version'}
            </Button>
          </>
        }
      >
        {confirmTarget && (
          <div className="rounded-md border border-line bg-[#fbf9f4] px-3 py-2.5">
            <div className="tabular text-[11px] font-semibold text-ink">
              v{confirmTarget.version} · {confirmTarget.message || 'No message'}
            </div>
            <div className="mt-0.5 text-[10px] text-ink-faint">
              {absoluteTime(confirmTarget.createdAt)}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

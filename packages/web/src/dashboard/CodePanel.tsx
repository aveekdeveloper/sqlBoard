import { useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { Check, Copy, Code2, Play, Wand2, X, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { ManifestDiagnostic } from './model.js';

export default function CodePanel({
  open,
  code,
  diagnostics,
  dirty,
  applying,
  editable = true,
  onChange,
  onClose,
  onApply,
  onFormat,
  onNotify,
}: {
  open: boolean;
  code: string;
  diagnostics: ManifestDiagnostic[];
  dirty: boolean;
  applying: boolean;
  editable?: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onApply?: () => void;
  onFormat: () => void;
  onNotify: (message: string) => void;
}) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
  const infos = diagnostics.filter((diagnostic) => diagnostic.severity === 'info');

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      onNotify('Manifest copied to clipboard');
    } catch {
      onNotify('Could not access the clipboard');
    }
  }

  return (
    <aside className="panel-in fixed inset-0 z-40 flex w-full flex-col border-l border-line bg-surface md:static md:inset-auto md:z-auto md:w-[510px] md:shrink-0">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f1eee7] text-ink-soft">
          <Code2 size={14} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-ink">Dashboard code</div>
          <div className="text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
            SQL-first manifest
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-[#f1eee7] hover:text-ink"
          aria-label="Close code panel"
        >
          <X size={15} />
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-line/70 bg-[#fbf9f4] px-4 py-2 text-[10px]">
        {dirty ? (
          <span className="inline-flex items-center gap-1.5 text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            Unapplied draft
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-positive">
            <Check size={11} />
            In sync with dashboard
          </span>
        )}
        <span className="text-ink-faint">·</span>
        <span className="tabular text-ink-faint">{code.split('\n').length} lines</span>
        {errors.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-signal">
            <AlertCircle size={11} /> {errors.length} error{errors.length === 1 ? '' : 's'}
          </span>
        )}
        {errors.length === 0 && warnings.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-warning">
            <AlertTriangle size={11} /> {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-[#fdfbf6]">
        <CodeMirror
          value={code}
          height="100%"
          theme="light"
          editable={editable}
          readOnly={!editable}
          extensions={[sql()]}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            autocompletion: false,
            bracketMatching: false,
            closeBrackets: false,
            searchKeymap: true,
          }}
          onChange={editable ? onChange : () => {}}
          className="h-full text-[12.5px]"
        />
      </div>

      {(errors.length > 0 || warnings.length > 0 || infos.length > 0) && (
        <div className="max-h-[150px] shrink-0 overflow-auto border-t border-line bg-[#fbf9f4] px-3 py-2">
          <div className="space-y-1">
            {[...errors, ...warnings, ...infos].slice(0, 12).map((diagnostic, index) => (
              <div
                key={`${diagnostic.code}-${index}`}
                className="flex items-start gap-1.5 rounded-md px-1.5 py-1 text-[10.5px] leading-relaxed"
              >
                <span className="mt-[3px] shrink-0">
                  {diagnostic.severity === 'error' ? (
                    <AlertCircle size={11} className="text-signal" />
                  ) : diagnostic.severity === 'warning' ? (
                    <AlertTriangle size={11} className="text-warning" />
                  ) : (
                    <Info size={11} className="text-ink-faint" />
                  )}
                </span>
                <span className="min-w-0 text-ink-muted">
                  {diagnostic.block && (
                    <span className="font-medium text-ink-soft">{diagnostic.block}: </span>
                  )}
                  {diagnostic.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <button
          type="button"
          onClick={onFormat}
          disabled={!editable}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-[#f1eee7] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          title="Canonicalize the manifest"
        >
          <Wand2 size={12} />
          Format
        </button>
        <button
          type="button"
          onClick={copyCode}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-[#f1eee7] hover:text-ink"
        >
          <Copy size={12} />
          Copy
        </button>
        <span className="ml-auto hidden text-[10px] text-ink-faint sm:inline">
          Use Commit to save changes
        </span>
      </footer>
    </aside>
  );
}

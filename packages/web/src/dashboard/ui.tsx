import {
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Info, X, AlertTriangle } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Button                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const base =
    'focus-ring inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40';
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-ink text-surface hover:bg-ink-soft shadow-sm',
    secondary:
      'border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink',
    ghost: 'text-ink-muted hover:bg-[#efebe2] hover:text-ink',
    danger: 'border border-signal/25 bg-signal-soft text-signal hover:border-signal/50',
  };
  const sizes: Record<ButtonSize, string> = {
    sm: 'h-7 px-2.5 text-[11px]',
    md: 'h-8 px-3 text-[12px]',
  };
  return (
    <button
      type="button"
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                             */
/* ------------------------------------------------------------------ */

const inputClass =
  'focus-ring w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-faint transition-colors hover:border-line-strong focus:border-accent/50';

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-faint">{hint}</span>}
    </label>
  );
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

export function TextArea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputClass} ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${inputClass} ${className}`} {...props}>
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog                                                             */
/* ------------------------------------------------------------------ */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fade-in fixed inset-0 z-[70] flex items-center justify-center bg-[#17181a]/35 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`dialog-in flex max-h-[90dvh] w-full ${width} flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop`}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-[#f1eee7] hover:text-ink"
            aria-label="Close dialog"
          >
            <X size={15} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-[#fbf9f4] px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Toast                                                              */
/* ------------------------------------------------------------------ */

export interface ToastMessage {
  id: number;
  text: string;
  tone?: 'success' | 'error' | 'info';
}

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, 3600);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  const Icon = toast.tone === 'error' ? AlertTriangle : toast.tone === 'info' ? Info : Check;
  const tone =
    toast.tone === 'error'
      ? 'text-signal'
      : toast.tone === 'info'
        ? 'text-ink-muted'
        : 'text-positive';

  return createPortal(
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 md:bottom-8">
      <div className="toast-in pointer-events-auto flex items-center gap-2 rounded-lg border border-line bg-ink px-3.5 py-2 text-[12px] font-medium text-surface shadow-lift">
        <Icon size={13} className={tone} />
        {toast.text}
        <button
          type="button"
          onClick={onDismiss}
          className="ml-1 rounded p-0.5 text-surface/50 transition-colors hover:text-surface"
          aria-label="Dismiss notification"
        >
          <X size={12} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                  */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-[#f7f4ed] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-all ${
            size === 'sm' ? 'px-2 py-1 text-[10.5px]' : 'px-2.5 py-1.5 text-[11.5px]'
          } ${
            value === option.value
              ? 'bg-surface text-ink shadow-sm ring-1 ring-line'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

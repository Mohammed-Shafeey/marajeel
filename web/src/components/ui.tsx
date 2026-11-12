import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, NetworkError } from '../api/client';
import { IconBack, IconX } from './icons';
import { useNavigate } from 'react-router-dom';
import { usePrefs } from '../Prefs';

type BtnVariant = 'primary' | 'ink' | 'outline' | 'danger' | 'ghost';

export function Button({ variant = 'outline', className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const cls = variant === 'ghost'
    ? 'inline-flex min-h-tap items-center justify-center gap-2 px-3 font-display text-[17px] font-bold text-fg-2 hover:text-fg'
    : `btn btn-${variant}`;
  return (
    <button type="button" className={`${cls} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`inline-flex h-11 w-11 items-center justify-center text-fg-2 hover:text-fg ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** Ink header bar with back arrow + title, as in the design boards. */
export function TopBar({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: string | boolean; actions?: ReactNode }) {
  const nav = useNavigate();
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 flex min-h-[60px] items-center gap-1 bg-[#121218] px-2 text-white lg:static">
      {back && (
        <IconButton label={t('common.back')} className="!text-white" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>
          <IconBack />
        </IconButton>
      )}
      <div className={`min-w-0 flex-1 ${back ? '' : 'ps-2'}`}>
        <h1 className="truncate font-display text-[24px] font-extrabold leading-tight">{title}</h1>
        {subtitle && <div className="truncate text-caption font-semibold text-[#C3C2CB]">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1 pe-1">
        {actions}
        <LangToggle />
      </div>
    </header>
  );
}

/** One-tap language switch: shows the language you'd switch to. */
function LangToggle() {
  const { prefs, setPrefs } = usePrefs();
  const toAr = prefs.lang === 'en';
  return (
    <button
      type="button"
      onClick={() => setPrefs({ lang: toAr ? 'ar' : 'en' })}
      aria-label={toAr ? 'العربية' : 'English'}
      title={toAr ? 'العربية' : 'English'}
      lang={toAr ? 'ar' : 'en'}
      className="inline-flex h-11 min-w-11 items-center justify-center border-2 border-[#45444E] px-2 font-display text-[16px] font-extrabold text-white hover:border-white"
    >
      {toAr ? 'ع' : 'EN'}
    </button>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function LoadingList({ rows = 4, height = 'h-16' }: { rows?: number; height?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={height} />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card-panel flex flex-col items-center gap-3 px-6 py-10 text-center">
      {icon && <div className="text-fg-3">{icon}</div>}
      <p className="font-display text-h2 font-extrabold">{title}</p>
      {hint && <p className="max-w-sm text-small text-fg-2">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="card-panel flex flex-col items-center gap-3 px-6 py-8 text-center">
      <p className="font-display text-h3 font-bold text-loss">{errorMessage(error, t)}</p>
      {onRetry && <Button onClick={onRetry}>{t('common.retry')}</Button>}
    </div>
  );
}

/** Translate an API error (or validation list) into readable text. */
export function errorMessage(e: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (e instanceof NetworkError) return t('errors.network');
  if (e instanceof ApiError) {
    if (e.errors.length) {
      return [...new Set(e.errors.map((x) => translateCode(x.code, x.params, t, x.message)))].join(' ');
    }
    return translateCode(e.code, null, t, e.message);
  }
  return t('common.error');
}

export function translateCode(code: string, params: Record<string, unknown> | null | undefined, t: (k: string, o?: Record<string, unknown>) => string, fallback?: string) {
  const p = { ...(params ?? {}) } as Record<string, unknown>;
  if (Array.isArray(p.allowed)) p.allowed = (p.allowed as number[]).join(` ${t('common.or')} `);
  const key = `errors.${code}`;
  const s = t(key, p);
  return s === key ? (fallback ?? t('common.error')) : s;
}

/** Bottom sheet on phones, centred dialog on desktop. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden bg-surface p-0 text-fg shadow-e3 backdrop:bg-[var(--scrim)] lg:m-auto lg:max-w-xl"
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <h2 className="flex-1 font-display text-h2 font-extrabold">{title}</h2>
            <IconButton label={t('common.close')} onClick={onClose}>
              <IconX />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && <div className="flex gap-2 border-t border-line px-4 py-3 [&>*]:flex-1" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---- confirm ----------------------------------------------------------------------------------

type ConfirmFn = (message: string, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ message: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback<ConfirmFn>((message, opts) => new Promise((resolve) => setState({ message, ...opts, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Sheet
        open={!!state}
        onClose={() => close(false)}
        title={t('common.confirm')}
        footer={
          <>
            <Button onClick={() => close(false)}>{t('common.cancel')}</Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state?.confirmLabel ?? t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-body">{state?.message}</p>
      </Sheet>
    </ConfirmCtx.Provider>
  );
}

// ---- toasts -----------------------------------------------------------------------------------

type Toast = { id: number; text: string; tone: 'ok' | 'error' | 'info' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    if (!text) return;
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(var(--nav-h) + var(--action-bar-h) + 16px + env(safe-area-inset-bottom))' }}
      >
        {toasts.map((x) => (
          <div
            key={x.id}
            role={x.tone === 'error' ? 'alert' : 'status'}
            className={`toast-in pointer-events-auto max-w-md px-4 py-3 font-semibold shadow-e2 ${
              x.tone === 'error' ? 'bg-loss text-white' : x.tone === 'info' ? 'bg-info-bg text-info' : 'bg-[#121218] text-white'
            }`}
          >
            {x.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between gap-2">
      <h2 className="h-section">{children}</h2>
      {aside && <div className="text-small text-fg-3">{aside}</div>}
    </div>
  );
}

export function Stepper({ value, onChange, min, max, label }: { value: number; onChange: (v: number) => void; min: number; max: number; label: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="btn btn-outline !h-11 !w-11 !px-0" aria-label="−" disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span className="num w-10 text-center text-h2 font-extrabold">{value}</span>
      <button type="button" className="btn btn-outline !h-11 !w-11 !px-0" aria-label="+" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

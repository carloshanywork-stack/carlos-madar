import type { ExecutionStatus } from '../api';

export const STATUS_LABELS: Record<ExecutionStatus, string> = {
  queued: 'في الانتظار',
  running: 'جارٍ التنفيذ',
  waiting: 'معلّق',
  succeeded: 'ناجح',
  failed: 'فاشل',
  canceled: 'ملغي',
};

export const STATUS_CLASSES: Record<ExecutionStatus, string> = {
  queued: 'border-slate-400/20 bg-slate-400/10 text-slate-300',
  running: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  waiting: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  succeeded: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  failed: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  canceled: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
};

export const TRIGGER_LABELS: Record<string, string> = {
  manual: 'يدوي',
  webhook: 'Webhook',
  schedule: 'جدولة',
};

export const MODE_LABELS: Record<string, string> = {
  production: 'إنتاج',
  test: 'تجريبي',
};

export const NODE_STATUS_LABELS: Record<string, string> = {
  running: 'جارٍ',
  succeeded: 'ناجح',
  failed: 'فاشل',
  skipped: 'متجاوز',
  canceled: 'ملغي',
};

export function isActiveStatus(status: ExecutionStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting';
}

export function formatDuration(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).valueOf();
  const end = finishedAt ? new Date(finishedAt).valueOf() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
  const ms = Math.max(0, end - start);
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} ث`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes} د ${seconds} ث`;
}

export function formatJson(value: unknown): string {
  if (value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatMoney(cents) {
  const value = Number(cents ?? 0);
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function egpToCents(value, { allowZero = true } = {}) {
  const text = String(value ?? '').trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error('أدخل مبلغاً صحيحاً حتى منزلتين عشريتين.');
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0'));
  const cents = whole * 100n + fraction;
  if ((!allowZero && cents === 0n) || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(allowZero ? 'المبلغ أكبر من الحد المسموح.' : 'يجب أن يكون المبلغ أكبر من صفر.');
  }
  return Number(cents);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function initials(value) {
  const text = String(value ?? '').trim();
  return text.slice(0, 1) || 'م';
}

export const statusLabels = {
  in_progress: 'قيد التنفيذ',
  review: 'بانتظار المراجعة',
  archived: 'مؤرشف',
  in_production: 'قيد التشغيل',
  ready: 'جاهز للتسليم',
  delivered_archived: 'تم التسليم',
  unpaid: 'غير مدفوع',
  partial: 'مدفوع جزئياً',
  paid: 'مدفوع',
};

export function statusTone(status) {
  if (['archived', 'delivered_archived', 'paid'].includes(status)) return 'success';
  if (['review', 'ready', 'partial'].includes(status)) return 'warning';
  if (['unpaid'].includes(status)) return 'danger';
  return 'info';
}

export function errorMessage(error) {
  return error?.message || 'حدث خطأ غير متوقع. حاول مرة أخرى.';
}

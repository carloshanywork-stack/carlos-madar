import { isFinanceOrAdmin } from './auth/authorization.js';

const PRIVATE_FINANCE_KEYS = new Set([
  'invoice',
  'salesInvoice',
  'sales_invoice',
  'sale_price_cents',
  'subtotal_cents',
  'tax_cents',
  'total_cents',
  'paid_total_cents',
  'remaining_cents',
  'payment_status',
  'unit_cost_cents',
  'line_total_cents',
  'treasury_entry_id',
  'treasuryEntry',
]);

function hideValue(value) {
  if (Array.isArray(value)) return value.map(hideValue);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const visible = {};
  for (const [key, field] of Object.entries(value)) {
    if (PRIVATE_FINANCE_KEYS.has(key)) continue;
    visible[key] = hideValue(field);
  }
  return visible;
}

/** Remove finance-only fields while roles without finance access keep operational data. */
export function financeAware(value, req) {
  return isFinanceOrAdmin(req) ? value : hideValue(value);
}

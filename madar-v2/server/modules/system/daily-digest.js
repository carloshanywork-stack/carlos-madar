import { db } from '../../database/connection.js';
import { getLowStockMaterials } from '../warehouse/service.js';

const CAIRO_TIMEZONE = 'Africa/Cairo';

function cairoDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Compiles a comprehensive daily business & operational digest across all MADAR subsystems.
 */
export function generateDailyDigest(targetDate = null, database = db) {
  const dateStr = targetDate || cairoDateString();
  const dayStart = `${dateStr} 00:00:00`;
  const dayEnd = `${dateStr} 23:59:59`;

  // 1. Maintenance & Visits
  const visitStats = database.prepare(`
    SELECT
      COUNT(*) as total_submitted,
      SUM(CASE WHEN review.status = 'approved' THEN 1 ELSE 0 END) as total_approved,
      SUM(CASE WHEN review.status = 'reshoot_required' THEN 1 ELSE 0 END) as total_reshoot_required,
      COUNT(DISTINCT visit.rep_user_id) as active_reps
    FROM rep_visits visit
    LEFT JOIN rep_visit_reviews review ON review.visit_id = visit.id
    WHERE visit.created_at BETWEEN ? AND ?
  `).get(dayStart, dayEnd);

  // 2. Workshop Orders
  const workshopStats = database.prepare(`
    SELECT
      COUNT(CASE WHEN created_at BETWEEN ? AND ? THEN 1 END) as new_orders,
      COUNT(CASE WHEN delivered_at BETWEEN ? AND ? THEN 1 END) as delivered_orders,
      COUNT(CASE WHEN status = 'in_production' AND deleted_at IS NULL THEN 1 END) as in_production_active
    FROM workshop_orders
    WHERE deleted_at IS NULL
  `).get(dayStart, dayEnd, dayStart, dayEnd);

  // 3. Treasury / Finance
  const financeStats = database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) as inflows_cents,
      COALESCE(SUM(CASE WHEN amount_cents < 0 THEN ABS(amount_cents) ELSE 0 END), 0) as outflows_cents
    FROM treasury_entries
    WHERE created_at BETWEEN ? AND ?
  `).get(dayStart, dayEnd);

  const inflowsCents = Number(financeStats?.inflows_cents || 0);
  const outflowsCents = Number(financeStats?.outflows_cents || 0);
  const netCents = inflowsCents - outflowsCents;

  // 4. Warehouse & Inventory
  const lowStock = getLowStockMaterials(database);
  const movementsToday = database.prepare(`
    SELECT COUNT(*) as total_movements
    FROM inventory_movements
    WHERE created_at BETWEEN ? AND ?
  `).get(dayStart, dayEnd);

  return {
    date: dateStr,
    generatedAt: new Date().toISOString(),
    maintenance: {
      submittedVisits: Number(visitStats?.total_submitted || 0),
      approvedVisits: Number(visitStats?.total_approved || 0),
      reshootRequired: Number(visitStats?.total_reshoot_required || 0),
      activeReps: Number(visitStats?.active_reps || 0),
    },
    workshop: {
      newOrders: Number(workshopStats?.new_orders || 0),
      deliveredOrders: Number(workshopStats?.delivered_orders || 0),
      inProductionActive: Number(workshopStats?.in_production_active || 0),
    },
    finance: {
      inflowsCents,
      outflowsCents,
      netCents,
      inflowsPounds: (inflowsCents / 100).toFixed(2),
      outflowsPounds: (outflowsCents / 100).toFixed(2),
      netPounds: (netCents / 100).toFixed(2),
    },
    warehouse: {
      lowStockMaterialsCount: lowStock.length,
      lowStockMaterials: lowStock.map((m) => ({ code: m.code, name: m.name, stock: m.stock, minStock: m.min_stock })),
      movementsCount: Number(movementsToday?.total_movements || 0),
    },
  };
}

/** Formats digest into a human-readable Arabic telegram / message string. */
export function formatDailyDigestText(digest) {
  return [
    `📊 *تقرير إغلاق يومية MADAR V2 — ${digest.date}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🔧 *الصيانة الميدانية:*`,
    `• إجمالي الزيارات المسجلة: ${digest.maintenance.submittedVisits}`,
    `• الزيارات المعتمدة: ${digest.maintenance.approvedVisits} ✓`,
    `• زيارات طلب إعادة التصوير: ${digest.maintenance.reshootRequired} ⚠️`,
    `• المناديب النشطون اليوم: ${digest.maintenance.activeReps}`,
    ``,
    `🏭 *ورشة الأكريليك والتصنيع:*`,
    `• أوامر جديدة اليوم: ${digest.workshop.newOrders}`,
    `• أوامر تم تسليمها: ${digest.workshop.deliveredOrders} ✓`,
    `• أوامر قيد التصنيع حالياً: ${digest.workshop.inProductionActive}`,
    ``,
    `💰 *حركة الخزينة والمالية:*`,
    `• المتحصلات النقدية: ${digest.finance.inflowsPounds} ج.م`,
    `• المصروفات النقدية: ${digest.finance.outflowsPounds} ج.م`,
    `• صافي حركة اليوم: ${digest.finance.netPounds} ج.م`,
    ``,
    `📦 *المخازن والخامات:*`,
    `• حركات مخزنية مسجلة: ${digest.warehouse.movementsCount}`,
    `• مواد تحت الحد الأدنى: ${digest.warehouse.lowStockMaterialsCount} ${digest.warehouse.lowStockMaterialsCount > 0 ? '⚠️' : '✓'}`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ].join('\n');
}

/** Dispatches the daily digest to external webhook if configured. */
export async function dispatchDailyDigestWebhook(digest, webhookUrl = process.env.MADAR_DAILY_DIGEST_WEBHOOK) {
  if (!webhookUrl) return { dispatched: false, reason: 'No webhook URL configured' };
  try {
    const text = formatDailyDigestText(digest);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        digest,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return { dispatched: response.ok, statusCode: response.status };
  } catch (err) {
    return { dispatched: false, error: err.message };
  }
}

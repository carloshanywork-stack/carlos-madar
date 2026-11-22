import { db } from '../../database/connection.js';
import { HttpError, positiveId, nonNegativeInteger } from '../http.js';

export function setWorkshopOverheadRate(input, database = db) {
  const yearMonth = String(input.yearMonth || input.year_month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new HttpError(400, 'yearMonth must be in YYYY-MM format (e.g. 2026-10).');
  }
  const hourlyRateCents = nonNegativeInteger(input.hourlyRateCents ?? input.hourly_rate_cents, 'hourlyRateCents');
  const rentAllocationCents = input.rentAllocationCents !== undefined || input.rent_allocation_cents !== undefined
    ? nonNegativeInteger(input.rentAllocationCents ?? input.rent_allocation_cents, 'rentAllocationCents')
    : 0;
  const notes = input.notes ? String(input.notes).slice(0, 500) : null;

  database.prepare(`
    INSERT INTO workshop_overhead_rates (year_month, hourly_rate_cents, rent_allocation_cents, notes, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(year_month) DO UPDATE SET
      hourly_rate_cents = excluded.hourly_rate_cents,
      rent_allocation_cents = excluded.rent_allocation_cents,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
  `).run(yearMonth, hourlyRateCents, rentAllocationCents, notes);

  return database.prepare('SELECT * FROM workshop_overhead_rates WHERE year_month = ?').get(yearMonth);
}

export function getWorkshopOverheadRate(yearMonth, database = db) {
  const ym = String(yearMonth || '').trim();
  const row = database.prepare('SELECT * FROM workshop_overhead_rates WHERE year_month = ?').get(ym);
  if (row) return row;
  return {
    year_month: ym,
    hourly_rate_cents: 20000,
    rent_allocation_cents: 0,
    is_default: true,
  };
}

export function listWorkshopOverheadRates(database = db) {
  return database.prepare('SELECT * FROM workshop_overhead_rates ORDER BY year_month DESC').all();
}

/**
 * Calculates the exact Job Costing (COGS), labor, machine time, offcut credits,
 * and profitability/variance analysis for a workshop order.
 */
export function getWorkshopOrderCosting(orderId, database = db) {
  const id = positiveId(orderId, 'orderId');
  const order = database.prepare(`
    SELECT o.id, o.order_code, o.product_name, o.client_id, o.status,
      o.sale_price_cents, o.quotation_id, o.created_at, o.delivered_at,
      c.name as client_name
    FROM workshop_orders o
    LEFT JOIN clients c ON c.id = o.client_id
    WHERE o.id = ? AND o.deleted_at IS NULL
  `).get(id);

  if (!order) throw new HttpError(404, 'Workshop order was not found.');

  // Fetch all inventory movements linked to this workshop order
  const movements = database.prepare(`
    SELECT
      im.id as movement_id, im.material_id, im.offcut_id, im.kind, im.quantity, im.warehouse,
      im.created_at as issued_at,
      COALESCE(im.unit_cost_cents, m.unit_cost_cents, ofc.unit_cost_cents, 0) as stamped_unit_cost_cents,
      COALESCE(m.name, ofc.name, 'خامة ورشة') as material_name,
      COALESCE(m.code, 'OFC') as material_code,
      COALESCE(m.unit, ofc.unit, 'قطعة') as unit
    FROM inventory_movements im
    LEFT JOIN materials m ON m.id = im.material_id
    LEFT JOIN secondary_warehouse_offcuts ofc ON ofc.id = im.offcut_id
    WHERE im.source_type = 'workshop_order' AND im.source_id = ? AND im.kind IN ('issue', 'return', 'offcut_return')
    ORDER BY im.id ASC
  `).all(id);

  let grossMaterialCostCents = 0;
  let rawOffcutCreditsCents = 0;
  const processedMovements = movements.map((item) => {
    const unitCost = Number(item.stamped_unit_cost_cents || 0);
    const lineCost = Math.round(Number(item.quantity) * unitCost);
    const isReturn = item.kind === 'return' || item.kind === 'offcut_return';

    if (isReturn) {
      rawOffcutCreditsCents += lineCost;
    } else {
      grossMaterialCostCents += lineCost;
    }

    return {
      ...item,
      total_cost_cents: isReturn ? -lineCost : lineCost,
      is_return: isReturn,
    };
  });

  // Credit source job once, capped at gross issue cost
  const offcutCreditsCents = Math.min(rawOffcutCreditsCents, grossMaterialCostCents);
  const materialCostCents = Math.max(0, grossMaterialCostCents - offcutCreditsCents);

  // Calculate actual labor and machine hours from workshop_stage_logs
  let laborCostCents = 0;
  let machineCostCents = 0;
  let totalLaborMinutes = 0;
  let totalMachineMinutes = 0;
  const monthlyOverheadAllocations = [];

  try {
    const stageLogs = database.prepare(`
      SELECT id, stage_name, action, duration_minutes, technician_hourly_rate_cents, created_at
      FROM workshop_stage_logs
      WHERE order_id = ?
      ORDER BY id ASC
    `).all(id);

    for (const log of stageLogs) {
      const minutes = Number(log.duration_minutes || 0);
      const rateCents = Number(log.technician_hourly_rate_cents || 10000); // 100 EGP/hr fallback
      const logMonth = (log.created_at || new Date().toISOString()).slice(0, 7);

      const rateRow = database.prepare(`
        SELECT hourly_rate_cents, rent_allocation_cents
        FROM workshop_overhead_rates
        WHERE year_month = ?
      `).get(logMonth);
      const periodMachineRateCents = rateRow ? Number(rateRow.hourly_rate_cents) : 20000;

      if (log.stage_name === 'cnc_laser' && minutes > 0) {
        totalMachineMinutes += minutes;
        const stageMachineCost = Math.round((minutes / 60) * periodMachineRateCents);
        machineCostCents += stageMachineCost;
        monthlyOverheadAllocations.push({
          stageLogId: log.id,
          yearMonth: logMonth,
          stageName: log.stage_name,
          durationMinutes: minutes,
          hourlyRateCents: periodMachineRateCents,
          costCents: stageMachineCost,
        });
      } else if (minutes > 0) {
        totalLaborMinutes += minutes;
        laborCostCents += Math.round((minutes / 60) * rateCents);
      }
    }
  } catch {
    // Stage logs table may not be queried in legacy setups
  }

  // Net actual cost
  const totalCostCents = Math.max(0, materialCostCents) + laborCostCents + machineCostCents;
  const salePriceCents = Number(order.sale_price_cents || 0);
  const grossProfitCents = salePriceCents - totalCostCents;
  const marginPercent = salePriceCents > 0
    ? Math.round((grossProfitCents / salePriceCents) * 1000) / 10
    : 0;
  const markupPercent = totalCostCents > 0
    ? Math.round((grossProfitCents / totalCostCents) * 1000) / 10
    : 0;

  // Check if linked to an approved quotation snapshot
  let variance = null;
  if (order.quotation_id) {
    try {
      const snapshot = database.prepare(`
        SELECT snapshot_payload_json FROM quotation_snapshots
        WHERE quotation_id = ?
        ORDER BY version_number DESC LIMIT 1
      `).get(order.quotation_id);

      if (snapshot) {
        const payload = JSON.parse(snapshot.snapshot_payload_json);
        const estimatedTotal = Number(payload.estimatedCostCents || 0);
        const estimatedPrice = Number(payload.netSalePriceCents || 0);
        const estimatedProfit = estimatedPrice - estimatedTotal;
        const estimatedMargin = estimatedPrice > 0 ? Math.round((estimatedProfit / estimatedPrice) * 1000) / 10 : 0;
        const varianceCents = totalCostCents - estimatedTotal;

        variance = {
          estimatedTotalCostCents: estimatedTotal,
          actualTotalCostCents: totalCostCents,
          varianceCents,
          estimatedProfitCents: estimatedProfit,
          actualProfitCents: grossProfitCents,
          estimatedMarginPercent: estimatedMargin,
          actualMarginPercent: marginPercent,
          grossMaterialCostCents,
          offcutCreditsCents,
          netMaterialCostCents: Math.max(0, materialCostCents),
          actualIssuedCostNetCents: Math.max(0, materialCostCents),
          laborCostCents,
          machineCostCents,
          overheadCostCents: machineCostCents,
          laborVarianceCents: laborCostCents - Number(payload.laborCostCents || 0),
          machineVarianceCents: machineCostCents - Number(payload.machineCostCents || 0),
          materialVarianceCents: Math.max(0, materialCostCents) - Number(payload.materialCostCents || 0),
          monthlyOverheadAllocations,
        };
      }
    } catch {
      // Snapshot parsing fallback
    }
  }

  return {
    orderId: order.id,
    orderCode: order.order_code,
    productName: order.product_name,
    clientName: order.client_name,
    status: order.status,
    salePriceCents,
    materialCostCents: Math.max(0, materialCostCents),
    grossMaterialCostCents,
    actualIssuedCostNetCents: Math.max(0, materialCostCents),
    offcutCreditsCents,
    laborCostCents,
    machineCostCents,
    overheadCostCents: machineCostCents,
    monthlyOverheadAllocations,
    totalLaborMinutes,
    totalMachineMinutes,
    totalCostCents,
    grossProfitCents,
    marginPercent,
    markupPercent,
    materialsCount: processedMovements.length,
    materialsUsed: processedMovements,
    variance,
  };
}

/**
 * Generates an executive profitability report across all non-deleted workshop orders.
 */
export function getWorkshopProfitabilitySummary(database = db) {
  const orders = database.prepare(`
    SELECT o.id, o.order_code, o.product_name, o.status, o.sale_price_cents
    FROM workshop_orders o
    WHERE o.deleted_at IS NULL
    ORDER BY o.id DESC
  `).all();

  const summaries = orders.map((o) => getWorkshopOrderCosting(o.id, database));
  const totalRevenueCents = summaries.reduce((sum, o) => sum + o.salePriceCents, 0);
  const totalCostCents = summaries.reduce((sum, o) => sum + o.totalCostCents, 0);
  const totalProfitCents = totalRevenueCents - totalCostCents;
  const overallMarginPercent = totalRevenueCents > 0
    ? Math.round((totalProfitCents / totalRevenueCents) * 1000) / 10
    : 0;

  return {
    totalOrders: orders.length,
    totalRevenueCents,
    totalMaterialCostCents: summaries.reduce((sum, o) => sum + o.materialCostCents, 0),
    totalLaborCostCents: summaries.reduce((sum, o) => sum + o.laborCostCents, 0),
    totalMachineCostCents: summaries.reduce((sum, o) => sum + o.machineCostCents, 0),
    totalCostCents,
    totalProfitCents,
    overallMarginPercent,
    orders: summaries,
  };
}

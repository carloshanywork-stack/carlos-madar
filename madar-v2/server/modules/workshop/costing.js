import { db } from '../../database/connection.js';
import { HttpError, positiveId } from '../http.js';

/**
 * Calculates the exact Job Costing (COGS) and profitability for a workshop order:
 * Material Cost = sum(issued_quantity * unit_cost_cents)
 * Gross Profit = sale_price_cents - Material Cost
 * Margin % = (Gross Profit / sale_price_cents) * 100
 */
export function getWorkshopOrderCosting(orderId, database = db) {
  const id = positiveId(orderId, 'orderId');
  const order = database.prepare(`
    SELECT o.id, o.order_code, o.product_name, o.client_id, o.status,
      o.sale_price_cents, o.created_at, o.delivered_at,
      c.name as client_name
    FROM workshop_orders o
    LEFT JOIN clients c ON c.id = o.client_id
    WHERE o.id = ? AND o.deleted_at IS NULL
  `).get(id);

  if (!order) throw new HttpError(404, 'Workshop order was not found.');

  const issuedMaterials = database.prepare(`
    SELECT m.id, m.code, m.name, m.specification, m.unit, m.unit_cost_cents,
      im.id as movement_id, im.quantity, im.created_at as issued_at,
      ROUND(im.quantity * m.unit_cost_cents) as total_cost_cents
    FROM inventory_movements im
    JOIN materials m ON m.id = im.material_id
    WHERE im.source_type = 'workshop_order' AND im.source_id = ?
    ORDER BY im.id ASC
  `).all(id);

  const materialCostCents = issuedMaterials.reduce((sum, item) => sum + Number(item.total_cost_cents || 0), 0);
  const salePriceCents = Number(order.sale_price_cents || 0);
  const grossProfitCents = salePriceCents - materialCostCents;
  const marginPercent = salePriceCents > 0
    ? Math.round((grossProfitCents / salePriceCents) * 1000) / 10
    : 0;

  return {
    orderId: order.id,
    orderCode: order.order_code,
    productName: order.product_name,
    clientName: order.client_name,
    status: order.status,
    salePriceCents,
    materialCostCents,
    grossProfitCents,
    marginPercent,
    materialsCount: issuedMaterials.length,
    materialsUsed: issuedMaterials,
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
  const totalMaterialCostCents = summaries.reduce((sum, o) => sum + o.materialCostCents, 0);
  const totalProfitCents = totalRevenueCents - totalMaterialCostCents;
  const overallMarginPercent = totalRevenueCents > 0
    ? Math.round((totalProfitCents / totalRevenueCents) * 1000) / 10
    : 0;

  return {
    totalOrders: orders.length,
    totalRevenueCents,
    totalMaterialCostCents,
    totalProfitCents,
    overallMarginPercent,
    orders: summaries,
  };
}

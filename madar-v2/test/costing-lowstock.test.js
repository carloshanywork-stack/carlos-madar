import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOffcutBarcode } from '../server/modules/warehouse/offcut-barcode.js';
import { getLowStockMaterials } from '../server/modules/warehouse/service.js';
import { getWorkshopOrderCosting, getWorkshopProfitabilitySummary } from '../server/modules/workshop/costing.js';
import { generateDailyDigest, formatDailyDigestText } from '../server/modules/system/daily-digest.js';
import { db } from '../server/database/connection.js';

test('generateOffcutBarcode formats valid scan-friendly barcode and label', () => {
  const result = generateOffcutBarcode({
    materialCode: 'ACR-BLK',
    thicknessMm: 3,
    widthCm: 45,
    heightCm: 60,
    id: 12,
  });

  assert.equal(result.barcode, 'MADAR-OFC-ACRBLK-3MM-45x60-0012');
  assert.equal(typeof result.checksum, 'string');
  assert.equal(result.checksum.length, 6);
  assert.ok(result.displayLabel.includes('45x60'));
});

test('getLowStockMaterials detects materials at or below minimum threshold', () => {
  const lowStock = getLowStockMaterials(db);
  assert.ok(Array.isArray(lowStock));
  // If there are materials below threshold, they should have deficit >= 0
  for (const item of lowStock) {
    assert.ok(item.stock <= item.min_stock);
    assert.ok(item.min_stock > 0);
  }
});

test('getWorkshopOrderCosting calculates COGS, gross profit, and margin correctly', () => {
  // Check if there are workshop orders
  const existingOrder = db.prepare('SELECT id FROM workshop_orders WHERE deleted_at IS NULL LIMIT 1').get();
  if (existingOrder) {
    const costing = getWorkshopOrderCosting(existingOrder.id, db);
    assert.equal(costing.orderId, existingOrder.id);
    assert.equal(typeof costing.materialCostCents, 'number');
    assert.equal(typeof costing.grossProfitCents, 'number');
    assert.equal(typeof costing.marginPercent, 'number');
    assert.equal(costing.grossProfitCents, costing.salePriceCents - costing.materialCostCents);
  }

  const summary = getWorkshopProfitabilitySummary(db);
  assert.equal(typeof summary.totalOrders, 'number');
  assert.equal(typeof summary.totalRevenueCents, 'number');
  assert.equal(typeof summary.totalProfitCents, 'number');
  assert.equal(typeof summary.overallMarginPercent, 'number');
});

test('generateDailyDigest and formatDailyDigestText compile executive report', () => {
  const digest = generateDailyDigest(null, db);
  assert.ok(digest.date);
  assert.ok(digest.maintenance);
  assert.ok(digest.workshop);
  assert.ok(digest.finance);
  assert.ok(digest.warehouse);
  assert.equal(typeof digest.finance.netPounds, 'string');

  const text = formatDailyDigestText(digest);
  assert.ok(text.includes('تقرير إغلاق يومية MADAR V2'));
  assert.ok(text.includes('الصيانة الميدانية:'));
  assert.ok(text.includes('حركة الخزينة والمالية:'));
});

import test, { after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MADAR_V2_DATABASE_PATH = ':memory:';
process.env.STORAGE_MOUNT_PATH = '';
process.env.MADAR_V2_BACKUP_MOUNT_PATH = '';

const { db } = await import('../server/database/connection.js');
const { initializeDatabase } = await import('../server/database/init.js');
const { generateOffcutBarcode } = await import('../server/modules/warehouse/offcut-barcode.js');
const { getLowStockMaterials } = await import('../server/modules/warehouse/service.js');
const { getWorkshopOrderCosting, getWorkshopProfitabilitySummary } = await import('../server/modules/workshop/costing.js');
const { generateDailyDigest, formatDailyDigestText } = await import('../server/modules/system/daily-digest.js');

after(() => db.close());
initializeDatabase({ database: db, initialAdminPassword: null });

db.exec(`
  INSERT INTO materials (id, code, name, unit, stock, min_stock, unit_cost_cents) VALUES
    (101, 'TEST-LOW', 'Low stock fixture', 'piece', 2, 5, 125),
    (102, 'TEST-AT-MIN', 'At minimum fixture', 'piece', 5, 5, 0),
    (103, 'TEST-ENOUGH', 'Sufficient stock fixture', 'piece', 6, 5, 0);
  INSERT INTO clients (id, code, name) VALUES (101, 'TEST-COSTING', 'Costing fixture');
  INSERT INTO workshop_orders (id, order_code, client_id, product_name, machine_type, sale_price_cents)
    VALUES (101, 'TEST-JOB', 101, 'Costing fixture', 'manual', 1000);
  INSERT INTO inventory_movements (material_id, kind, quantity, warehouse, source_type, source_id)
    VALUES (101, 'issue', 2, 'main', 'workshop_order', 101);
`);

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
  assert.deepEqual(lowStock.map(({ code, deficit }) => [code, deficit]), [
    ['TEST-LOW', 3],
    ['TEST-AT-MIN', 0],
  ]);
});

test('getWorkshopOrderCosting calculates COGS, gross profit, and margin correctly', () => {
  const costing = getWorkshopOrderCosting(101, db);
  assert.equal(costing.orderId, 101);
  assert.equal(costing.materialCostCents, 250);
  assert.equal(costing.grossProfitCents, 750);
  assert.equal(costing.marginPercent, 75);

  const summary = getWorkshopProfitabilitySummary(db);
  assert.equal(summary.totalOrders, 1);
  assert.equal(summary.totalRevenueCents, 1000);
  assert.equal(summary.totalProfitCents, 750);
  assert.equal(summary.overallMarginPercent, 75);
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

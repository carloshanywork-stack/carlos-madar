import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-phase3-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'phase3.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
]);

const adminPassword = 'phase3-test-admin-password';
initializeDatabase({ initialAdminPassword: adminPassword });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: adminPassword }),
});
if (!loginResponse.ok) throw new Error(`Test administrator login failed: ${loginResponse.status}`);
const loginCookieHeader = loginResponse.headers.getSetCookie?.()[0] ?? loginResponse.headers.get('set-cookie');
const authCookie = loginCookieHeader?.split(';', 1)[0];
if (!authCookie) throw new Error('Test administrator login did not issue a session cookie.');

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), cookie: authCookie },
  });
  return {
    response,
    body: await response.json(),
  };
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function createWorkshopOrder(clientId, productName) {
  const { response, body } = await request('/api/workshop/orders', jsonOptions('POST', {
    clientId,
    productName,
    description: 'Phase 3 warehouse verification order',
    machineType: 'cnc_router',
    targetDeliveryDate: '2026-12-15',
    salePriceCents: 100000,
    technicianIds: [],
  }));
  assert.equal(response.status, 201);
  return body;
}

test('Phase 3 warehouse lifecycle preserves Phase 1/2 domains and reconciles physical stock', async () => {
  const clientResult = await request('/api/clients', jsonOptions('POST', { name: 'Warehouse Verification Client' }));
  assert.equal(clientResult.response.status, 201);
  const clientId = clientResult.body.id;

  const materialResult = await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'MAT-ACR-3MM',
    name: 'Clear acrylic sheet',
    specification: '3 mm transparent acrylic',
    unit: 'لوح',
    minStock: 2,
    unitCostCents: 12500,
    initialStock: 10,
  }));
  assert.equal(materialResult.response.status, 201);
  const material = materialResult.body;
  assert.equal(material.stock, 10);
  assert.equal(material.unit_cost_cents, 12500);
  assert.equal(material.is_low_stock, false);
  const initialMovement = db.prepare(`
    SELECT kind, quantity, warehouse, source_type FROM inventory_movements WHERE material_id = ?
  `).get(material.id);
  assert.deepEqual(initialMovement, {
    kind: 'purchase',
    quantity: 10,
    warehouse: 'main',
    source_type: 'manual',
  });

  const firstWorkshopOrder = await createWorkshopOrder(clientId, 'Acrylic display stand');
  const excessiveIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: firstWorkshopOrder.id,
    sourceWarehouse: 'main',
    materialId: material.id,
    quantity: 11,
  }));
  assert.equal(excessiveIssue.response.status, 409);
  assert.equal((await request('/api/warehouse/materials')).body.find((row) => row.id === material.id).stock, 10);
  const mainIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: firstWorkshopOrder.id,
    sourceWarehouse: 'main',
    materialId: material.id,
    quantity: 1,
    notes: 'صرف لوح أكريليك شفاف 3 مم',
  }));
  assert.equal(mainIssue.response.status, 201);
  assert.equal(mainIssue.body.movement.kind, 'issue');
  assert.equal(mainIssue.body.movement.warehouse, 'main');
  assert.equal(mainIssue.body.movement.source_type, 'workshop_order');
  assert.equal(mainIssue.body.workshop_order_code, firstWorkshopOrder.order_code);
  assert.equal((await request('/api/warehouse/materials')).body.find((row) => row.id === material.id).stock, 9);

  const ready = await request(`/api/workshop/orders/${firstWorkshopOrder.id}/ready`, jsonOptions('POST', {
    offcuts: [{
      name: 'Acrylic display stand leftover',
      dimensions: '80×40 cm',
      quantity: 1,
      unit: 'قطعة',
      materialId: material.id,
    }],
  }));
  assert.equal(ready.response.status, 200);
  const reusableOffcut = ready.body.offcuts[0];
  assert.equal(reusableOffcut.status, 'available');
  assert.equal(reusableOffcut.dimensions, '80×40 cm');
  assert.equal(reusableOffcut.origin_workshop_order_id, firstWorkshopOrder.id);

  const secondWorkshopOrder = await createWorkshopOrder(clientId, 'Second acrylic display stand');
  const excessiveOffcutIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: secondWorkshopOrder.id,
    sourceWarehouse: 'secondary',
    offcutId: reusableOffcut.id,
    quantity: 1.5,
  }));
  assert.equal(excessiveOffcutIssue.response.status, 409);
  assert.equal((await request('/api/warehouse/offcuts?status=available')).body
    .find((offcut) => offcut.id === reusableOffcut.id).quantity, 1);
  const secondaryIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: secondWorkshopOrder.id,
    sourceWarehouse: 'secondary',
    offcutId: reusableOffcut.id,
    quantity: 1,
  }));
  assert.equal(secondaryIssue.response.status, 201);
  assert.equal(secondaryIssue.body.movement.warehouse, 'secondary');
  assert.equal(secondaryIssue.body.movement.offcut_id, reusableOffcut.id);
  assert.equal(secondaryIssue.body.offcut.status, 'consumed');
  const invalidScrapSale = await request('/api/warehouse/offcuts/scrap-sales', jsonOptions('POST', {
    offcutIds: [reusableOffcut.id],
    totalSaleAmountCents: 1000,
  }));
  assert.equal(invalidScrapSale.response.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM treasury_entries').get().count, 0);

  const scrapOffcut = await request('/api/warehouse/offcuts', jsonOptions('POST', {
    name: 'Unusable acrylic scrap',
    dimensions: 'small mixed pieces',
    quantity: 1,
    unit: 'kg',
    notes: 'Manual scrap sale test',
  }));
  assert.equal(scrapOffcut.response.status, 201);
  const scrapSale = await request('/api/warehouse/offcuts/scrap-sales', jsonOptions('POST', {
    offcutIds: [scrapOffcut.body.id],
    totalSaleAmountCents: 50000,
    buyerName: 'Local recycler',
  }));
  assert.equal(scrapSale.response.status, 201);
  assert.equal(scrapSale.body.offcuts[0].status, 'scrapped_sold');
  assert.deepEqual(
    db.prepare(`
      SELECT kind, category, amount_cents, reference, notes
      FROM treasury_entries WHERE id = ?
    `).get(scrapSale.body.treasuryEntry.id),
    {
      kind: 'income',
      category: 'إيرادات بيع خردة ومخلفات تشغيل',
      amount_cents: 50000,
      reference: 'بيع خردة بواقي ورشة',
      notes: 'Buyer: Local recycler',
    },
  );

  const maintenance = await request('/api/maintenance/orders', jsonOptions('POST', {
    clientId,
    area: 'Cairo',
    employeeIds: [],
    notes: 'This must not receive warehouse materials.',
  }));
  assert.equal(maintenance.response.status, 201);
  const blockedMaintenanceIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
    maintenanceOrderId: maintenance.body.id,
    sourceWarehouse: 'main',
    materialId: material.id,
    quantity: 1,
    materialCostCents: 12500,
  }));
  assert.equal(blockedMaintenanceIssue.response.status, 400);
  assert.match(blockedMaintenanceIssue.body.error, /Unsupported field/);
  const blockedFinancialIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: maintenance.body.id,
    sourceWarehouse: 'main',
    materialId: material.id,
    quantity: 1,
    materialCostCents: 12500,
  }));
  assert.equal(blockedFinancialIssue.response.status, 400);
  assert.equal((await request('/api/warehouse/materials')).body.find((row) => row.id === material.id).stock, 9);

  const countableOffcut = await request('/api/warehouse/offcuts', jsonOptions('POST', {
    name: 'Counted acrylic remnant', dimensions: '30×20 cm', quantity: 2, unit: 'قطعة',
  }));
  const foundOffcut = await request('/api/warehouse/offcuts', jsonOptions('POST', {
    name: 'Unrecorded remnant', dimensions: '20×10 cm', quantity: 1, unit: 'قطعة',
  }));
  assert.equal(countableOffcut.response.status, 201);
  assert.equal(foundOffcut.response.status, 201);

  const countStart = await request('/api/warehouse/stock-counts/start', jsonOptions('POST', {
    notes: 'Monthly physical count',
  }));
  assert.equal(countStart.response.status, 201);
  assert.equal(countStart.body.status, 'open');
  assert.equal(countStart.body.lines.main.length, 1);
  assert.equal(countStart.body.lines.main[0].material_id, material.id);
  assert.deepEqual(
    countStart.body.lines.offcuts.map((line) => line.offcut_id).sort((a, b) => a - b),
    [countableOffcut.body.id, foundOffcut.body.id].sort((a, b) => a - b),
  );

  const duringCountIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: secondWorkshopOrder.id,
    sourceWarehouse: 'main',
    materialId: material.id,
    quantity: 0.5,
  }));
  assert.equal(duringCountIssue.response.status, 201);
  assert.equal((await request('/api/warehouse/materials')).body.find((row) => row.id === material.id).stock, 8.5);

  const incompleteReconciliation = await request(
    `/api/warehouse/stock-counts/${countStart.body.id}/reconcile`,
    jsonOptions('POST', { main: [], offcuts: [] }),
  );
  assert.equal(incompleteReconciliation.response.status, 400);

  const reconciliation = await request(
    `/api/warehouse/stock-counts/${countStart.body.id}/reconcile`,
    jsonOptions('POST', {
      main: [{ materialId: material.id, countedQuantity: 8 }],
      offcuts: [
        { offcutId: countableOffcut.body.id, countedQuantity: 0 },
        { offcutId: foundOffcut.body.id, countedQuantity: 2 },
      ],
      notes: 'Physical count checked by warehouse staff.',
    }),
  );
  assert.equal(reconciliation.response.status, 200);
  assert.equal(reconciliation.body.session.status, 'reconciled');
  assert.equal(reconciliation.body.session.closed_by !== null, true);
  assert.equal((await request('/api/warehouse/materials')).body.find((row) => row.id === material.id).stock, 8);
  assert.equal(reconciliation.body.session.lines.main[0].snapshot_quantity, 9);
  assert.equal(reconciliation.body.session.lines.main[0].system_quantity_at_reconcile, 8.5);
  assert.equal(reconciliation.body.session.lines.main[0].variance_quantity, -0.5);
  assert.deepEqual(
    reconciliation.body.variances.map((variance) => variance.movement_id !== null),
    [true, true, true],
  );
  const countMovements = db.prepare(`
    SELECT kind, quantity, warehouse FROM inventory_movements
    WHERE source_type = 'stock_count' AND source_id = ? ORDER BY id
  `).all(countStart.body.id);
  assert.deepEqual(countMovements, [
    { kind: 'variance_loss', quantity: 0.5, warehouse: 'main' },
    { kind: 'variance_loss', quantity: 2, warehouse: 'secondary' },
    { kind: 'variance_gain', quantity: 1, warehouse: 'secondary' },
  ]);
  assert.equal(
    (await request(`/api/warehouse/offcuts?status=variance_lost`)).body[0].id,
    countableOffcut.body.id,
  );
  assert.equal(
    (await request(`/api/warehouse/offcuts?status=available`)).body.some((offcut) => offcut.id === foundOffcut.body.id),
    true,
  );

  const secondReconcile = await request(
    `/api/warehouse/stock-counts/${countStart.body.id}/reconcile`,
    jsonOptions('POST', {
      main: [{ materialId: material.id, countedQuantity: 8 }],
      offcuts: [
        { offcutId: countableOffcut.body.id, countedQuantity: 0 },
        { offcutId: foundOffcut.body.id, countedQuantity: 2 },
      ],
    }),
  );
  assert.equal(secondReconcile.response.status, 409);

  const movements = await request('/api/warehouse/movements');
  assert.equal(movements.response.status, 200);
  assert.ok(movements.body.length <= 100);
  assert.equal(
    movements.body.find((row) => row.id === mainIssue.body.movement.id).workshop_order_code,
    firstWorkshopOrder.order_code,
  );
  const productionDetail = await request(`/api/workshop/orders/${firstWorkshopOrder.id}`);
  assert.equal(productionDetail.response.status, 200);
  assert.equal(productionDetail.body.materialConsumption.length, 1);
  assert.equal(productionDetail.body.materialConsumption[0].material_code, 'MAT-ACR-3MM');
  assert.equal(productionDetail.body.materialConsumption[0].warehouse, 'main');

  const emptyStockMaterial = await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'MAT-EMPTY', name: 'Empty stock material', unit: 'sheet', minStock: 0,
    unitCostCents: 0, initialStock: 0,
  }));
  assert.equal(emptyStockMaterial.response.status, 201);
  assert.equal(emptyStockMaterial.body.is_low_stock, true);
});

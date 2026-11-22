import { createHash } from 'node:crypto';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import {
  allowOnlyKeys,
  HttpError,
  nonNegativeInteger,
  optionalText,
  positiveId,
  requireObject,
  requireText,
} from '../http.js';

const PRODUCT_TYPES = ['channel_letters', 'banner_flex', 'cladding_facade', 'custom_signage'];
const QUOTATION_STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'converted_to_order'];

function nextQuotationCode(database) {
  const codes = database.prepare("SELECT quotation_code FROM product_quotations WHERE quotation_code GLOB 'QUO-[0-9]*'").all();
  const largest = codes.reduce((maximum, row) => {
    const match = /^QUO-(\d+)$/.exec(row.quotation_code);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 1000);
  return `QUO-${String(largest + 1).padStart(4, '0')}`;
}

export function calculateSignageJobEstimate(productType, specs = {}, targetMargin = 0.25) {
  if (!PRODUCT_TYPES.includes(productType)) {
    throw new HttpError(400, `productType must be one of: ${PRODUCT_TYPES.join(', ')}.`);
  }
  const margin = Number(targetMargin);
  if (!Number.isFinite(margin) || margin < 0 || margin >= 1.0) {
    throw new HttpError(400, 'targetMargin must be a number between 0 and 0.99 (less than 100%).');
  }

  let materialCostCents = 0;
  let machineCostCents = 0;
  let laborCostCents = 0;
  let outsourcedCostCents = 0;
  let transportCostCents = 0;
  let installCostCents = 0;
  let overheadCostCents = 0;

  const breakdown = {
    materials: [],
    machineHours: 0,
    laborHours: 0,
    notes: [],
  };

  if (productType === 'channel_letters') {
    const letterHeightCm = Number(specs.letterHeightCm ?? 40);
    const letterCount = Number(specs.letterCount ?? 1);
    const depthCm = Number(specs.depthCm ?? 8);
    const acrylicUnitCostCents = Number(specs.acrylicSheetCostCents ?? 125000); // e.g. 1,250 EGP per 3mm sheet
    const forexSheetCostCents = Number(specs.forexSheetCostCents ?? 45000); // 450 EGP per forex sheet
    const ledModuleCostCents = Number(specs.ledModuleCostCents ?? 1200); // 12 EGP per module
    const powerSupplyCostCents = Number(specs.powerSupplyCostCents ?? 40000); // 400 EGP per 12V 300W IP67 unit
    const returnStripCostPerMeterCents = Number(specs.returnStripCostPerMeterCents ?? 3500); // 35 EGP per meter of profile

    // Approximate calculations
    const perimeterPerLetterM = (3.5 * letterHeightCm) / 100;
    const totalPerimeterM = Math.round(perimeterPerLetterM * letterCount * 100) / 100;
    const faceAreaPerLetterM2 = 0.65 * Math.pow(letterHeightCm / 100, 2);
    const totalFaceAreaM2 = Math.round(faceAreaPerLetterM2 * letterCount * 100) / 100;

    // Standard sheet 1.22 x 2.44 = 2.977 m2, 70% nesting packing fraction
    const sheetUsableAreaM2 = 2.977 * 0.70;
    const acrylicSheetsRequired = Math.max(1, Math.ceil(totalFaceAreaM2 / sheetUsableAreaM2));
    const forexSheetsRequired = Math.max(1, Math.ceil(totalFaceAreaM2 / sheetUsableAreaM2));

    // LED modules: 1 module every 6 cm of stroke
    const totalModules = Math.max(letterCount * 8, Math.ceil((totalPerimeterM * 100) / 6));
    const totalWatts = Math.round(totalModules * 1.2 * 1.25);
    const powerSuppliesCount = Math.max(1, Math.ceil(totalWatts / 300));

    const returnsCostCents = Math.round(totalPerimeterM * returnStripCostPerMeterCents);
    const adhesivesAndFastenersCents = Number(specs.adhesivesCostCents ?? (letterCount * 1500)); // 15 EGP per letter misc

    const acrylicTotalCents = acrylicSheetsRequired * acrylicUnitCostCents;
    const forexTotalCents = forexSheetsRequired * forexSheetCostCents;
    const ledTotalCents = totalModules * ledModuleCostCents;
    const powerTotalCents = powerSuppliesCount * powerSupplyCostCents;

    materialCostCents = acrylicTotalCents + forexTotalCents + ledTotalCents + powerTotalCents + returnsCostCents + adhesivesAndFastenersCents;

    breakdown.materials.push(
      { name: 'Acrylic Face Sheets', quantity: acrylicSheetsRequired, unit: 'sheet', costCents: acrylicTotalCents },
      { name: 'Forex Backing Sheets', quantity: forexSheetsRequired, unit: 'sheet', costCents: forexTotalCents },
      { name: 'LED Injection Modules 1.2W', quantity: totalModules, unit: 'piece', costCents: ledTotalCents },
      { name: 'IP67 12V Power Supplies', quantity: powerSuppliesCount, unit: 'unit', costCents: powerTotalCents },
      { name: 'Letter Returns / Profiles', quantity: totalPerimeterM, unit: 'linear_m', costCents: returnsCostCents },
      { name: 'Adhesives, Fasteners & Wiring', quantity: letterCount, unit: 'set', costCents: adhesivesAndFastenersCents },
    );

    // Machine & Labor times
    const cncHours = Math.max(1, Math.round(((totalPerimeterM * 0.08) + 0.5) * 10) / 10);
    const cncRateCents = Number(specs.cncHourlyRateCents ?? 20000); // 200 EGP / hr
    machineCostCents = Math.round(cncHours * cncRateCents);
    breakdown.machineHours = cncHours;

    const fabHours = Math.max(2, Math.round(((letterCount * 1.5) + (totalModules * 0.02)) * 10) / 10);
    const laborRateCents = Number(specs.laborHourlyRateCents ?? 10000); // 100 EGP / hr
    laborCostCents = Math.round(fabHours * laborRateCents);
    breakdown.laborHours = fabHours;

    outsourcedCostCents = Number(specs.outsourcedCostCents ?? 0);
    transportCostCents = Number(specs.transportCostCents ?? 40000); // 400 EGP delivery
    installCostCents = Number(specs.installCostCents ?? (letterCount * 5000)); // 50 EGP per letter installation
    overheadCostCents = Number(specs.overheadCostCents ?? Math.round((cncHours + fabHours) * 3000)); // 30 EGP / prod hr
  } else if (productType === 'banner_flex') {
    const widthM = Number(specs.widthM ?? 3);
    const heightM = Number(specs.heightM ?? 1.5);
    const quantity = Number(specs.quantity ?? 1);
    const areaM2 = Math.round(widthM * heightM * quantity * 100) / 100;
    const bannerPerimeterM = 2 * (widthM + heightM) * quantity;

    const bannerMaterialCostCents = Math.round(areaM2 * Number(specs.bannerCostPerM2Cents ?? 15000)); // 150 EGP/m2
    const frameCostCents = Math.round(bannerPerimeterM * Number(specs.frameCostPerMeterCents ?? 8000)); // 80 EGP/m iron tube
    const grommetsCostCents = Math.round((bannerPerimeterM / 0.3) * Number(specs.grommetCostCents ?? 200)); // 2 EGP/grommet

    materialCostCents = bannerMaterialCostCents + frameCostCents + grommetsCostCents;
    breakdown.materials.push(
      { name: 'Flex Banner 510g Print', quantity: areaM2, unit: 'm2', costCents: bannerMaterialCostCents },
      { name: 'Iron Tube Structure', quantity: bannerPerimeterM, unit: 'm', costCents: frameCostCents },
      { name: 'Reinforced Eyelets/Grommets', quantity: Math.round(bannerPerimeterM / 0.3), unit: 'piece', costCents: grommetsCostCents },
    );

    const printHours = Math.max(0.5, Math.round((areaM2 / 10) * 10) / 10);
    machineCostCents = Math.round(printHours * Number(specs.printerHourlyRateCents ?? 25000));
    breakdown.machineHours = printHours;

    const weldLaborHours = Math.max(1, Math.round((bannerPerimeterM * 0.2) * 10) / 10);
    laborCostCents = Math.round(weldLaborHours * Number(specs.laborHourlyRateCents ?? 10000));
    breakdown.laborHours = weldLaborHours;

    transportCostCents = Number(specs.transportCostCents ?? 30000);
    installCostCents = Number(specs.installCostCents ?? 50000);
    overheadCostCents = Number(specs.overheadCostCents ?? 20000);
  } else if (productType === 'cladding_facade') {
    const widthM = Number(specs.widthM ?? 6);
    const heightM = Number(specs.heightM ?? 3);
    const areaM2 = Math.round(widthM * heightM * 100) / 100;

    const panelCostCents = Math.round(areaM2 * 1.15 * Number(specs.claddingCostPerM2Cents ?? 85000)); // 850 EGP/m2
    const steelStructureCents = Math.round(areaM2 * Number(specs.steelStructureCostPerM2Cents ?? 35000));
    const sealantAndAccessoriesCents = Math.round(areaM2 * 10000);

    materialCostCents = panelCostCents + steelStructureCents + sealantAndAccessoriesCents;
    breakdown.materials.push(
      { name: 'Aluminum Composite Cladding Panels', quantity: areaM2 * 1.15, unit: 'm2', costCents: panelCostCents },
      { name: 'Steel Grid Substructure', quantity: areaM2, unit: 'm2', costCents: steelStructureCents },
      { name: 'Fasteners, PU Sealant & Rivets', quantity: areaM2, unit: 'm2_set', costCents: sealantAndAccessoriesCents },
    );

    const cncHours = Math.max(2, Math.round((areaM2 / 4) * 10) / 10);
    machineCostCents = Math.round(cncHours * Number(specs.cncHourlyRateCents ?? 20000));
    breakdown.machineHours = cncHours;

    const installHours = Math.max(8, Math.round((areaM2 * 1.2) * 10) / 10);
    laborCostCents = Math.round(installHours * Number(specs.laborHourlyRateCents ?? 12000));
    breakdown.laborHours = installHours;

    transportCostCents = Number(specs.transportCostCents ?? 60000);
    installCostCents = Number(specs.installCostCents ?? 120000);
    overheadCostCents = Number(specs.overheadCostCents ?? 50000);
  } else {
    // custom_signage: direct inputs
    materialCostCents = Number(specs.materialCostCents ?? 0);
    machineCostCents = Number(specs.machineCostCents ?? 0);
    laborCostCents = Number(specs.laborCostCents ?? 0);
    outsourcedCostCents = Number(specs.outsourcedCostCents ?? 0);
    transportCostCents = Number(specs.transportCostCents ?? 0);
    installCostCents = Number(specs.installCostCents ?? 0);
    overheadCostCents = Number(specs.overheadCostCents ?? 0);
  }

  const totalCostCents = materialCostCents + machineCostCents + laborCostCents + outsourcedCostCents + transportCostCents + installCostCents + overheadCostCents;

  // Pricing: Net Sale Price = Cost / (1 - targetMargin)
  const netSalePriceCents = totalCostCents > 0
    ? Math.round(totalCostCents / (1 - margin))
    : 0;

  const expectedProfitCents = netSalePriceCents - totalCostCents;
  const marginPercent = netSalePriceCents > 0
    ? Math.round((expectedProfitCents / netSalePriceCents) * 1000) / 10
    : 0;
  const markupPercent = totalCostCents > 0
    ? Math.round((expectedProfitCents / totalCostCents) * 1000) / 10
    : 0;

  return {
    productType,
    targetMargin: margin,
    materialCostCents,
    machineCostCents,
    laborCostCents,
    outsourcedCostCents,
    transportCostCents,
    installCostCents,
    overheadCostCents,
    totalCostCents,
    netSalePriceCents,
    expectedProfitCents,
    marginPercent,
    markupPercent,
    breakdown,
  };
}

export function listQuotations(database = db, filters = {}) {
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  if (filters.clientId) {
    conditions.push('client_id = ?');
    params.push(positiveId(filters.clientId, 'clientId'));
  }
  if (filters.status && QUOTATION_STATUSES.includes(filters.status)) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  return database.prepare(`
    SELECT q.*, c.name AS client_name, c.code AS client_code
    FROM product_quotations q
    JOIN clients c ON c.id = q.client_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY q.created_at DESC, q.id DESC
  `).all(...params).map((row) => ({
    ...row,
    specifications: JSON.parse(row.specifications_json || '{}'),
  }));
}

export function getQuotation(quotationId, database = db) {
  const id = positiveId(quotationId, 'quotationId');
  const quote = database.prepare(`
    SELECT q.*, c.name AS client_name, c.code AS client_code
    FROM product_quotations q
    JOIN clients c ON c.id = q.client_id
    WHERE q.id = ? AND q.deleted_at IS NULL
  `).get(id);
  if (!quote) throw new HttpError(404, 'Product quotation was not found.');

  const snapshots = database.prepare(`
    SELECT id, quotation_id, version_number, snapshot_hash, created_at
    FROM quotation_snapshots WHERE quotation_id = ? ORDER BY version_number DESC
  `).all(id);

  return {
    ...quote,
    specifications: JSON.parse(quote.specifications_json || '{}'),
    snapshots,
  };
}

export function createQuotation(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['clientId', 'title', 'productType', 'specifications', 'targetMargin', 'manualNetSalePriceCents']);
  const clientId = positiveId(body.clientId, 'clientId');
  const title = requireText(body.title, 'title', { maxLength: 300 });
  const productType = body.productType ?? 'channel_letters';
  const specifications = body.specifications ? requireObject(body.specifications, 'specifications') : {};
  const targetMargin = body.targetMargin !== undefined ? Number(body.targetMargin) : 0.25;

  const estimate = calculateSignageJobEstimate(productType, specifications, targetMargin);
  const netSalePriceCents = body.manualNetSalePriceCents !== undefined
    ? nonNegativeInteger(body.manualNetSalePriceCents, 'manualNetSalePriceCents')
    : estimate.netSalePriceCents;

  const actualProfitCents = netSalePriceCents - estimate.totalCostCents;
  const actualMargin = netSalePriceCents > 0 ? (actualProfitCents / netSalePriceCents) : 0;
  // If margin < 0.20, quote enters pending_approval gate
  const initialStatus = actualMargin < 0.20 ? 'pending_approval' : 'draft';

  return database.transaction(() => {
    if (!database.prepare('SELECT 1 FROM clients WHERE id = ? AND deleted_at IS NULL').get(clientId)) {
      throw new HttpError(404, 'Active client was not found.');
    }
    const quotationCode = nextQuotationCode(database);
    const result = database.prepare(`
      INSERT INTO product_quotations
        (quotation_code, client_id, title, product_type, specifications_json, target_margin,
         estimated_cost_cents, net_sale_price_cents, tax_cents, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      quotationCode,
      clientId,
      title,
      productType,
      JSON.stringify(specifications),
      targetMargin,
      estimate.totalCostCents,
      netSalePriceCents,
      initialStatus,
      actorId,
    );
    const quotationId = Number(result.lastInsertRowid);
    recordAudit({
      database,
      actorId,
      action: 'create_quotation',
      entityType: 'product_quotation',
      entityId: quotationId,
      newValues: {
        quotation_code: quotationCode,
        client_id: clientId,
        title,
        product_type: productType,
        estimated_cost_cents: estimate.totalCostCents,
        net_sale_price_cents: netSalePriceCents,
        status: initialStatus,
      },
    });
    return getQuotation(quotationId, database);
  }).immediate();
}

export function approveQuotation(quotationId, actorId = null, database = db) {
  const id = positiveId(quotationId, 'quotationId');
  return database.transaction(() => {
    const quote = getQuotation(id, database);
    if (quote.status === 'approved' || quote.status === 'converted_to_order') {
      return quote;
    }
    if (quote.status === 'rejected') {
      throw new HttpError(409, 'Cannot approve a rejected quotation.');
    }

    const payload = JSON.stringify({
      quotationId: quote.id,
      code: quote.quotation_code,
      clientId: quote.client_id,
      title: quote.title,
      productType: quote.product_type,
      specifications: quote.specifications,
      targetMargin: quote.target_margin,
      estimatedCostCents: quote.estimated_cost_cents,
      netSalePriceCents: quote.net_sale_price_cents,
      approvedAt: new Date().toISOString(),
      approvedBy: actorId,
    });
    const hash = createHash('sha256').update(payload).digest('hex');

    const nextVersion = (quote.snapshots?.length ?? 0) + 1;
    database.prepare(`
      INSERT INTO quotation_snapshots (quotation_id, version_number, snapshot_payload_json, snapshot_hash)
      VALUES (?, ?, ?, ?)
    `).run(id, nextVersion, payload, hash);

    database.prepare(`
      UPDATE product_quotations
      SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(actorId, id);

    recordAudit({
      database,
      actorId,
      action: 'approve_quotation',
      entityType: 'product_quotation',
      entityId: id,
      newValues: { status: 'approved', version: nextVersion, snapshot_hash: hash },
    });

    return getQuotation(id, database);
  }).immediate();
}

export function convertQuotationToWorkshopOrder(quotationId, input = {}, actorId = null, database = db) {
  const id = positiveId(quotationId, 'quotationId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['targetDeliveryDate', 'technicianIds', 'machineType', 'description']);

  return database.transaction(() => {
    const quote = getQuotation(id, database);
    if (quote.status !== 'approved') {
      throw new HttpError(409, 'Only approved quotations can be converted into workshop production orders.');
    }

    // Check existing order
    const existing = database.prepare('SELECT id FROM workshop_orders WHERE quotation_id = ? AND deleted_at IS NULL').get(id);
    if (existing) throw new HttpError(409, 'A workshop order already exists for this quotation.');

    // Compute next order code MFG-XXXX
    const orderCodes = database.prepare("SELECT order_code FROM workshop_orders WHERE order_code GLOB 'MFG-[0-9]*'").all();
    const largest = orderCodes.reduce((maximum, row) => {
      const match = /^MFG-(\d+)$/.exec(row.order_code);
      return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 1000);
    const orderCode = `MFG-${String(largest + 1).padStart(4, '0')}`;

    const machineType = body.machineType ?? (quote.product_type === 'channel_letters' ? 'both' : 'cnc_router');
    const targetDeliveryDate = body.targetDeliveryDate ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const technicianIds = Array.isArray(body.technicianIds) ? body.technicianIds : [];

    const result = database.prepare(`
      INSERT INTO workshop_orders
        (order_code, client_id, quotation_id, product_name, description, machine_type,
         target_delivery_date, sale_price_cents, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_production', ?)
    `).run(
      orderCode,
      quote.client_id,
      quote.id,
      quote.title,
      body.description || `Generated from quotation ${quote.quotation_code}`,
      machineType,
      targetDeliveryDate,
      quote.net_sale_price_cents,
      actorId,
    );
    const orderId = Number(result.lastInsertRowid);

    // Assign technicians
    if (technicianIds.length > 0) {
      const assign = database.prepare('INSERT INTO workshop_order_technicians (order_id, employee_id) VALUES (?, ?)');
      for (const techId of technicianIds) assign.run(orderId, techId);
    }

    // Mark quotation converted
    database.prepare("UPDATE product_quotations SET status = 'converted_to_order', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);

    recordAudit({
      database,
      actorId,
      action: 'convert_quotation_to_order',
      entityType: 'workshop_order',
      entityId: orderId,
      newValues: { order_code: orderCode, quotation_id: id, sale_price_cents: quote.net_sale_price_cents },
    });

    return {
      orderId,
      orderCode,
      quotationCode: quote.quotation_code,
    };
  }).immediate();
}

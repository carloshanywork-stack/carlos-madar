import { Router } from 'express';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { setOrderArchiveMonth } from '../archive-period.js';
import { requireAdmin, requireFinanceOrAdmin, requireSupervisorOrAdmin, isFinanceOrAdmin } from '../auth/authorization.js';
import { safeOriginalName, asyncHandler } from '../http.js';
import { resolveStorageFile } from '../storage.js';
import { memoryUpload } from '../upload.js';
import { requestActorId } from '../actor.js';
import { requireWorkshopMutationAccess, requireProcurementMutationAccess } from '../auth/authorization.js';
import { financeAware as roleAware } from '../visibility.js';
import {
  createWorkshopOrder,
  getWorkshopDesign,
  getWorkshopOrder,
  listWorkshopOrders,
  saveWorkshopDesign,
  transitionWorkshopToDelivered,
  transitionWorkshopToReady,
} from './service.js';
import { getWorkshopOrderCosting, getWorkshopProfitabilitySummary } from './costing.js';
import {
  approveQuotation,
  calculateSignageJobEstimate,
  convertQuotationToWorkshopOrder,
  createQuotation,
  getQuotation,
  listQuotations,
} from './quotations.service.js';
import {
  listTechnicianJobs,
  logStageAction,
  submitOrderQualityInspection,
} from './technician.service.js';
import {
  createPurchaseRequest,
  listPurchaseRequests,
  createPurchaseOrder,
  approvePurchaseOrder,
  readPurchaseOrder,
  listPurchaseOrders,
  createGoodsReceipt,
  readGoodsReceipt,
  listGoodsReceipts,
  getWorkshopOrderTrace,
  cashPurchase,
} from './procurement.service.js';

export function requireWorkshopOrFinanceAccess(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication is required.' });
    return;
  }
  const role = req.user.role;
  const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
  if (
    role === 'admin' ||
    role === 'operations' ||
    isFinanceOrAdmin(req) ||
    permissions.includes('manage_finance') ||
    permissions.includes('manage_workshop')
  ) {
    next();
    return;
  }
  res.status(403).json({ error: 'صلاحية العمليات أو المالية أو مدير النظام مطلوبة للشراء النقدي المباشر.' });
}

const router = Router();
const designUpload = memoryUpload({
  maxBytes: 40 * 1024 * 1024,
  extensions: ['.dxf', '.cdr', '.ai', '.pdf'],
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'design', maxCount: 1 },
]);

// --- Quotations & Product Cost Calculator ---
router.get('/quotations', (req, res, next) => {
  try {
    res.json(roleAware(listQuotations(undefined, req.query), req));
  } catch (error) {
    next(error);
  }
});

router.post('/quotations/estimate-preview', (req, res, next) => {
  try {
    const result = calculateSignageJobEstimate(
      req.body.productType,
      req.body.specifications,
      req.body.targetMargin,
    );
    res.json(roleAware(result, req));
  } catch (error) {
    next(error);
  }
});

router.post('/quotations', (req, res, next) => {
  try {
    res.status(201).json(roleAware(createQuotation(req.body, requestActorId(req)), req));
  } catch (error) {
    next(error);
  }
});

router.get('/quotations/:id', (req, res, next) => {
  try {
    res.json(roleAware(getQuotation(req.params.id), req));
  } catch (error) {
    next(error);
  }
});

router.post('/quotations/:id/approve', (req, res, next) => {
  try {
    res.json(roleAware(approveQuotation(req.params.id, requestActorId(req)), req));
  } catch (error) {
    next(error);
  }
});

router.post('/quotations/:id/convert-to-order', requireWorkshopMutationAccess, (req, res, next) => {
  try {
    const result = convertQuotationToWorkshopOrder(req.params.id, req.body, requestActorId(req));
    res.status(result.alreadyConverted ? 200 : 201).json(roleAware(result, req));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/convert', requireWorkshopMutationAccess, (req, res, next) => {
  try {
    const quotationId = req.body?.quotationId ?? req.body?.quotation_id;
    const result = convertQuotationToWorkshopOrder(quotationId, req.body, requestActorId(req));
    res.status(result.alreadyConverted ? 200 : 201).json(roleAware(result, req));
  } catch (error) {
    next(error);
  }
});

// --- Technician Workbench Endpoints ---
router.get('/technician/jobs', (req, res, next) => {
  try {
    res.json(roleAware(listTechnicianJobs(req.user), req));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/stage-log', (req, res, next) => {
  try {
    if (req.user && req.user.role === 'technician') {
      const emp = db.prepare('SELECT id FROM employees WHERE user_id = ? AND active = 1 AND deleted_at IS NULL').get(req.user.id);
      if (!emp) {
        res.status(403).json({ error: 'User is not registered as an active workshop employee.' });
        return;
      }
      const isAssigned = db.prepare('SELECT 1 FROM workshop_order_technicians WHERE order_id = ? AND employee_id = ?').get(req.params.id, emp.id);
      if (!isAssigned) {
        res.status(403).json({ error: 'Technicians can only log time for assigned jobs.' });
        return;
      }
    }
    res.status(201).json(roleAware(logStageAction(req.params.id, req.user, req.body), req));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/qa-submit', (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const orderId = Number(req.params.id);
    const order = db.prepare('SELECT id, order_code, status FROM workshop_orders WHERE id = ? AND deleted_at IS NULL').get(orderId);
    if (!order) {
      res.status(404).json({ error: 'Workshop order was not found.' });
      return;
    }
    if (order.status !== 'in_production') {
      res.status(409).json({ error: 'Only workshop orders in production can be submitted for quality inspection.' });
      return;
    }

    let employeeId = null;
    let hourlyRateCents = 10000;
    if (req.user.role === 'technician') {
      const emp = db.prepare('SELECT id, base_salary_cents FROM employees WHERE user_id = ? AND active = 1 AND deleted_at IS NULL').get(req.user.id);
      if (!emp) {
        res.status(403).json({ error: 'User is not registered as an active workshop employee.' });
        return;
      }
      const isAssigned = db.prepare('SELECT 1 FROM workshop_order_technicians WHERE order_id = ? AND employee_id = ?').get(orderId, emp.id);
      if (!isAssigned) {
        res.status(403).json({ error: 'Technicians can only submit QA for assigned jobs.' });
        return;
      }
      employeeId = emp.id;
      if (emp.base_salary_cents > 0) hourlyRateCents = Math.round(emp.base_salary_cents / 208);
    } else {
      const emp = db.prepare("SELECT id, base_salary_cents FROM employees WHERE (user_id = ? OR department = 'Workshop') AND active = 1 AND deleted_at IS NULL LIMIT 1").get(req.user.id);
      if (emp) {
        employeeId = emp.id;
        if (emp.base_salary_cents > 0) hourlyRateCents = Math.round(emp.base_salary_cents / 208);
      }
    }

    const notes = req.body?.notes ? String(req.body.notes).slice(0, 1000) : 'تم إرسال الأمر لفحص الجودة النهائي';

    if (employeeId) {
      db.prepare(`
        INSERT INTO workshop_stage_logs
          (order_id, employee_id, stage_name, action, duration_minutes, technician_hourly_rate_cents, notes)
        VALUES (?, ?, 'qa_inspection', 'complete', 0, ?, ?)
      `).run(orderId, employeeId, hourlyRateCents, notes);
    }

    recordAudit({
      database: db,
      actorId: req.user.id,
      action: 'qa_submit',
      entityType: 'workshop_order',
      entityId: orderId,
      newValues: { order_id: orderId, notes },
    });

    res.json({
      success: true,
      orderId,
      orderCode: order.order_code,
      status: order.status,
      message: 'تم إرسال الأمر بنجاح لمراجعة واعتماد الجودة.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/qa-review', requireSupervisorOrAdmin, (req, res, next) => {
  try {
    if (req.user && req.user.role === 'technician') {
      res.status(403).json({ error: 'Technicians cannot approve quality inspections; supervisor or admin access required.' });
      return;
    }
    res.json(roleAware(submitOrderQualityInspection(req.params.id, req.user, req.body), req));
  } catch (error) {
    next(error);
  }
});

// --- Existing Workshop Orders ---
router.get('/orders', (req, res, next) => {
  try {
    if (req.user && req.user.role === 'technician') {
      res.status(403).json({ error: 'Technicians can only access assigned jobs via /api/workshop/technician/jobs.' });
      return;
    }
    const orders = listWorkshopOrders(req.query.status, undefined, { month: req.query.month });
    res.json(roleAware(orders, req));
  } catch (error) {
    next(error);
  }
});

router.patch('/orders/:id/archive-month', requireAdmin, (req, res, next) => {
  try { res.json(setOrderArchiveMonth('workshop', req.params.id, req.body, requestActorId(req))); }
  catch (error) { next(error); }
});

router.post('/orders', requireWorkshopMutationAccess, (req, res, next) => {
  try {
    res.status(201).json(roleAware(createWorkshopOrder(req.body, requestActorId(req)), req));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/designs', requireWorkshopMutationAccess, designUpload, asyncHandler(async (req, res) => {
  const files = [...(req.files?.file ?? []), ...(req.files?.design ?? [])];
  if (files.length !== 1) {
    res.status(400).json({ error: 'Upload exactly one vector file using the file field.' });
    return;
  }
  res.status(201).json(await saveWorkshopDesign(req.params.id, files[0], requestActorId(req)));
}));

router.post('/orders/:id/ready', requireWorkshopMutationAccess, (req, res, next) => {
  try {
    res.json(roleAware(transitionWorkshopToReady(req.params.id, req.body, requestActorId(req)), req));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/deliver', requireWorkshopMutationAccess, (req, res, next) => {
  try {
    res.json(roleAware(transitionWorkshopToDelivered(req.params.id, req.body, requestActorId(req)), req));
  } catch (error) {
    next(error);
  }
});

router.get('/designs/:fileId/download', asyncHandler(async (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication is required to download design files.' });
    return;
  }
  const file = getWorkshopDesign(req.params.fileId);
  if (req.user.role === 'technician') {
    const emp = db.prepare('SELECT id FROM employees WHERE user_id = ? AND active = 1 AND deleted_at IS NULL').get(req.user.id);
    if (!emp) {
      res.status(403).json({ error: 'User is not registered as an active workshop employee.' });
      return;
    }
    const isAssigned = db.prepare('SELECT 1 FROM workshop_order_technicians WHERE order_id = ? AND employee_id = ?').get(file.order_id, emp.id);
    if (!isAssigned) {
      res.status(403).json({ error: 'Technicians can only download drawings for assigned jobs.' });
      return;
    }
  }
  const absolutePath = await resolveStorageFile(file.stored_path);
  res.set('X-Content-Type-Options', 'nosniff');
  res.download(absolutePath, safeOriginalName(file.original_name), (error) => {
    if (error && !res.headersSent) next(error);
  });
}));

router.get('/profitability', (req, res, next) => {
  try {
    res.json(roleAware(getWorkshopProfitabilitySummary(), req));
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:id/costing', (req, res, next) => {
  try {
    res.json(roleAware(getWorkshopOrderCosting(req.params.id), req));
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:id/trace', (req, res, next) => {
  try {
    res.json(roleAware(getWorkshopOrderTrace(req.params.id), req));
  } catch (error) {
    next(error);
  }
});

// --- Procurement & Goods Receipts ---
router.post('/procurement/requests', requireProcurementMutationAccess, (req, res, next) => {
  try {
    res.status(201).json(createPurchaseRequest(req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/procurement/requests', (req, res, next) => {
  try {
    res.json(listPurchaseRequests(req.query));
  } catch (error) {
    next(error);
  }
});

router.post('/procurement/orders', requireProcurementMutationAccess, (req, res, next) => {
  try {
    res.status(201).json(createPurchaseOrder(req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/procurement/orders', (req, res, next) => {
  try {
    res.json(listPurchaseOrders(req.query));
  } catch (error) {
    next(error);
  }
});

router.get('/procurement/orders/:id', (req, res, next) => {
  try {
    res.json(readPurchaseOrder(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.post('/procurement/orders/:id/approve', requireProcurementMutationAccess, (req, res, next) => {
  try {
    res.json(approvePurchaseOrder(req.params.id, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/procurement/receipts', requireProcurementMutationAccess, (req, res, next) => {
  try {
    res.status(201).json(createGoodsReceipt(req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/procurement/receipts', (req, res, next) => {
  try {
    res.json(listGoodsReceipts(req.query));
  } catch (error) {
    next(error);
  }
});

router.get('/procurement/receipts/:id', (req, res, next) => {
  try {
    res.json(readGoodsReceipt(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.post('/procurement/cash-purchase', requireWorkshopOrFinanceAccess, (req, res, next) => {
  try {
    res.status(201).json(cashPurchase(req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:id', (req, res, next) => {
  try {
    if (req.user && req.user.role === 'technician') {
      const emp = db.prepare('SELECT id FROM employees WHERE user_id = ? AND active = 1 AND deleted_at IS NULL').get(req.user.id);
      if (!emp) {
        res.status(403).json({ error: 'User is not registered as an active workshop employee.' });
        return;
      }
      const isAssigned = db.prepare('SELECT 1 FROM workshop_order_technicians WHERE order_id = ? AND employee_id = ?').get(req.params.id, emp.id);
      if (!isAssigned) {
        res.status(403).json({ error: 'Technicians can only access their assigned jobs.' });
        return;
      }
    }
    res.json(roleAware(getWorkshopOrder(req.params.id), req));
  } catch (error) {
    next(error);
  }
});

export default router;

import { Router } from 'express';
import { setOrderArchiveMonth } from '../archive-period.js';
import { requireAdmin, requireFinanceOrAdmin, requireSupervisorOrAdmin } from '../auth/authorization.js';
import { safeOriginalName, asyncHandler } from '../http.js';
import { resolveStorageFile } from '../storage.js';
import { memoryUpload } from '../upload.js';
import { requestActorId } from '../actor.js';
import { requireWorkshopMutationAccess } from '../auth/authorization.js';
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
} from './procurement.service.js';

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
    res.status(201).json(roleAware(convertQuotationToWorkshopOrder(req.params.id, req.body, requestActorId(req)), req));
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
    res.status(201).json(roleAware(logStageAction(req.params.id, req.user, req.body), req));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/qa-submit', (req, res, next) => {
  try {
    res.json(roleAware(submitOrderQualityInspection(req.params.id, req.user, req.body), req));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/qa-review', requireSupervisorOrAdmin, (req, res, next) => {
  try {
    res.json(roleAware(submitOrderQualityInspection(req.params.id, req.user, req.body), req));
  } catch (error) {
    next(error);
  }
});

// --- Existing Workshop Orders ---
router.get('/orders', (req, res, next) => {
  try {
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
router.post('/procurement/requests', requireWorkshopMutationAccess, (req, res, next) => {
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

router.post('/procurement/orders', requireWorkshopMutationAccess, (req, res, next) => {
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

router.post('/procurement/orders/:id/approve', requireWorkshopMutationAccess, (req, res, next) => {
  try {
    res.json(approvePurchaseOrder(req.params.id, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/procurement/receipts', requireWorkshopMutationAccess, (req, res, next) => {
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

router.get('/orders/:id', (req, res, next) => {
  try {
    res.json(roleAware(getWorkshopOrder(req.params.id), req));
  } catch (error) {
    next(error);
  }
});

export default router;

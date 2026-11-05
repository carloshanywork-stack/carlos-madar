import { Router } from 'express';
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

const router = Router();
const designUpload = memoryUpload({
  maxBytes: 40 * 1024 * 1024,
  extensions: ['.dxf', '.cdr', '.ai', '.pdf'],
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'design', maxCount: 1 },
]);


router.get('/orders', (req, res, next) => {
  try {
    const orders = listWorkshopOrders(req.query.status);
    res.json(roleAware(orders, req));
  } catch (error) {
    next(error);
  }
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
  const file = getWorkshopDesign(req.params.fileId);
  const absolutePath = await resolveStorageFile(file.stored_path);
  res.set('X-Content-Type-Options', 'nosniff');
  res.download(absolutePath, safeOriginalName(file.original_name), (error) => {
    if (error && !res.headersSent) next(error);
  });
}));

router.get('/orders/:id', (req, res, next) => {
  try {
    res.json(roleAware(getWorkshopOrder(req.params.id), req));
  } catch (error) {
    next(error);
  }
});

export default router;

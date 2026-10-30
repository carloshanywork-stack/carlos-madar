import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { asyncHandler } from '../http.js';
import { memoryUpload } from '../upload.js';
import { requestActorId } from '../actor.js';
import {
  addMaintenanceCard,
  archiveMaintenanceOrder,
  createMachine,
  createMaintenanceOrder,
  disburseMaintenanceCustody,
  getMaintenanceOrder,
  getMaintenancePhoto,
  listAreas,
  listMachines,
  listMaintenanceOrders,
  transitionMaintenanceToReview,
  updateMaintenanceCard,
  uploadMaintenancePhoto,
} from './service.js';

const router = Router();
const photoUpload = memoryUpload({
  maxBytes: 25 * 1024 * 1024,
  extensions: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'],
}).single('photo');

router.get('/areas', (req, res) => {
  res.json(listAreas());
});

router.get('/machines', (req, res) => {
  res.json(listMachines({ area: req.query.area, search: req.query.search ?? req.query.q }));
});

router.post('/machines', (req, res, next) => {
  try {
    res.status(201).json(createMachine(req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/orders', (req, res, next) => {
  try {
    res.json(listMaintenanceOrders(req.query.status));
  } catch (error) {
    next(error);
  }
});

router.post('/orders', (req, res, next) => {
  try {
    res.status(201).json(createMaintenanceOrder(req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/cards', (req, res, next) => {
  try {
    res.status(201).json(addMaintenanceCard(req.params.id, req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/custody-advance', (req, res, next) => {
  try {
    res.status(201).json(disburseMaintenanceCustody(req.params.id, req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/cards/:cardId/photos/:phase', photoUpload, asyncHandler(async (req, res) => {
  res.status(201).json(await uploadMaintenancePhoto(
    req.params.id,
    req.params.cardId,
    req.params.phase,
    req.file,
    requestActorId(req),
  ));
}));

router.get('/orders/:id/cards/:cardId/photos/:phase/:filename', asyncHandler(async (req, res) => {
  const absolutePath = await getMaintenancePhoto(
    req.params.id,
    req.params.cardId,
    req.params.phase,
    req.params.filename,
  );
  const type = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  }[extname(req.params.filename).toLowerCase()];
  res.set({ 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(await readFile(absolutePath));
}));

router.patch('/orders/:id/cards/:cardId', asyncHandler(async (req, res) => {
  res.json(await updateMaintenanceCard(
    req.params.id,
    req.params.cardId,
    req.body,
    requestActorId(req),
  ));
}));

router.patch('/orders/:id/status', (req, res, next) => {
  try {
    res.json(transitionMaintenanceToReview(req.params.id, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/archive', (req, res, next) => {
  try {
    res.json(archiveMaintenanceOrder(req.params.id, req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:id', (req, res, next) => {
  try {
    res.json(getMaintenanceOrder(req.params.id));
  } catch (error) {
    next(error);
  }
});

export default router;

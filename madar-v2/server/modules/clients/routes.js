import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { asyncHandler, positiveId } from '../http.js';
import { resolveStorageFile } from '../storage.js';
import { memoryUpload } from '../upload.js';
import { requestActorId } from '../actor.js';
import { requireFinanceOrAdmin } from '../auth/authorization.js';
import {
  createClient,
  deactivateClient,
  getClientLogo,
  getClientProfile,
  getClientStatement,
  listClients,
  saveClientLogo,
  updateClient,
} from './service.js';

const router = Router();
const logoUpload = memoryUpload({
  maxBytes: 10 * 1024 * 1024,
  extensions: ['.jpg', '.jpeg', '.png', '.webp'],
}).single('logo');

router.get('/', (req, res) => {
  res.json(listClients());
});

router.post('/', asyncHandler((req, res) => {
  res.status(201).json(createClient(req.body, requestActorId(req)));
}));

router.put('/:id', asyncHandler((req, res) => {
  res.json(updateClient(req.params.id, req.body, requestActorId(req)));
}));

router.delete('/:id', asyncHandler((req, res) => {
  res.json(deactivateClient(req.params.id, requestActorId(req)));
}));

router.get('/:id/logo', asyncHandler(async (req, res) => {
  const id = positiveId(req.params.id, 'clientId');
  const storedPath = getClientLogo(id);
  const absolutePath = await resolveStorageFile(storedPath);
  const type = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }[extname(storedPath).toLowerCase()];
  res.set({ 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(await readFile(absolutePath));
}));

router.post('/:id/logo', logoUpload, asyncHandler(async (req, res) => {
  res.status(200).json(await saveClientLogo(req.params.id, req.file, requestActorId(req)));
}));

router.get('/:id/statement', requireFinanceOrAdmin, (req, res, next) => {
  try {
    res.json(getClientStatement(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    res.json(getClientProfile(req.params.id));
  } catch (error) {
    next(error);
  }
});

export default router;

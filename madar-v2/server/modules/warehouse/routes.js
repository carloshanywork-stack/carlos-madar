import { Router } from 'express';
import { requestActorId } from '../actor.js';
import {
  createMaterial,
  createOffcut,
  issueMaterial,
  listMaterials,
  listMovements,
  listOffcuts,
  sellScrap,
} from './service.js';
import { reconcileStockCount, startStockCount } from './stock-count.service.js';

const router = Router();

router.get('/materials', (req, res) => {
  res.json(listMaterials());
});

router.post('/materials', (req, res) => {
  res.status(201).json(createMaterial(req.body, requestActorId(req)));
});

router.get('/movements', (req, res) => {
  res.json(listMovements());
});

router.post('/issue', (req, res) => {
  res.status(201).json(issueMaterial(req.body, requestActorId(req)));
});

router.get('/offcuts', (req, res) => {
  res.json(listOffcuts(req.query.status ?? 'available'));
});

router.post('/offcuts', (req, res) => {
  res.status(201).json(createOffcut(req.body, requestActorId(req)));
});

router.post('/offcuts/scrap-sales', (req, res) => {
  res.status(201).json(sellScrap(req.body, requestActorId(req)));
});

router.post('/stock-counts/start', (req, res) => {
  res.status(201).json(startStockCount(req.body, requestActorId(req)));
});

router.post('/stock-counts/:id/reconcile', (req, res) => {
  res.json(reconcileStockCount(req.params.id, req.body, requestActorId(req)));
});

export default router;

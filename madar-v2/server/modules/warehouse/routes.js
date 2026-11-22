import { Router } from 'express';
import { requestActorId } from '../actor.js';
import { requireFinanceOrAdmin, requireWarehouseMutationAccess } from '../auth/authorization.js';
import { financeAware as roleAware } from '../visibility.js';
import {
  createMaterial,
  createOffcut,
  getLowStockMaterials,
  issueMaterial,
  listMaterials,
  listMovements,
  listOffcuts,
  releaseReservation,
  reserveMaterial,
  returnMaterial,
  sellScrap,
} from './service.js';
import { reconcileStockCount, startStockCount } from './stock-count.service.js';
import { buildWarehouseWorkbook } from './export.js';

const router = Router();

router.get('/export.xlsx', requireFinanceOrAdmin, (req, res) => {
  const buffer = buildWarehouseWorkbook();
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="madar-v2-warehouse-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    'Cache-Control': 'private, no-store',
  });
  res.send(buffer);
});

router.get('/materials', (req, res) => {
  const materials = listMaterials();
  res.json(roleAware(materials, req));
});

router.get('/materials/low-stock', (req, res) => {
  res.json(roleAware(getLowStockMaterials(), req));
});

router.post('/materials', requireWarehouseMutationAccess, (req, res) => {
  res.status(201).json(roleAware(createMaterial(req.body, requestActorId(req)), req));
});

router.get('/movements', (req, res) => {
  res.json(roleAware(listMovements(), req));
});

router.post('/issue', requireWarehouseMutationAccess, (req, res) => {
  res.status(201).json(roleAware(issueMaterial(req.body, requestActorId(req)), req));
});

router.post('/return', requireWarehouseMutationAccess, (req, res) => {
  res.status(201).json(roleAware(returnMaterial(req.body, requestActorId(req)), req));
});

router.post('/reservations', requireWarehouseMutationAccess, (req, res) => {
  res.status(201).json(roleAware(reserveMaterial(req.body, requestActorId(req)), req));
});

router.post('/reservations/:id/release', requireWarehouseMutationAccess, (req, res) => {
  res.json(roleAware(releaseReservation(req.params.id, requestActorId(req)), req));
});

router.get('/offcuts', (req, res) => {
  const offcuts = listOffcuts(req.query.status ?? 'available');
  res.json(roleAware(offcuts, req));
});

router.post('/offcuts', requireWarehouseMutationAccess, (req, res) => {
  res.status(201).json(roleAware(createOffcut(req.body, requestActorId(req)), req));
});

router.post('/offcuts/scrap-sales', requireFinanceOrAdmin, (req, res) => {
  res.status(201).json(roleAware(sellScrap(req.body, requestActorId(req)), req));
});

router.post('/stock-counts/start', requireWarehouseMutationAccess, (req, res) => {
  res.status(201).json(roleAware(startStockCount(req.body, requestActorId(req)), req));
});

router.post('/stock-counts/:id/reconcile', requireWarehouseMutationAccess, (req, res) => {
  res.json(roleAware(reconcileStockCount(req.params.id, req.body, requestActorId(req)), req));
});

export default router;

import { Router } from 'express';
import { requestActorId } from '../actor.js';
import { createPurchaseInvoice, listInvoices, recordSalesReceipt } from './invoices.service.js';
import { createTreasuryEntry, getTreasury } from './treasury.service.js';

const router = Router();

router.get('/treasury', (req, res) => {
  res.json(getTreasury());
});

router.post('/treasury/entries', (req, res) => {
  res.status(201).json(createTreasuryEntry(req.body, requestActorId(req)));
});

router.get('/invoices', (req, res) => {
  res.json(listInvoices(req.query.kind));
});

router.post('/invoices/purchase', (req, res) => {
  res.status(201).json(createPurchaseInvoice(req.body, requestActorId(req)));
});

router.post('/invoices/:id/receipt', (req, res) => {
  res.status(201).json(recordSalesReceipt(req.params.id, req.body, requestActorId(req)));
});

export default router;

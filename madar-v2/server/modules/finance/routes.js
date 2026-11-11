import { Router } from 'express';
import { requestActorId } from '../actor.js';
import { requireFinanceOrAdmin } from '../auth/authorization.js';
import { createPurchaseInvoice, listInvoices, recordPurchasePayment, recordSalesReceipt } from './invoices.service.js';
import { createTreasuryEntry, getTreasury } from './treasury.service.js';

const router = Router();

router.get('/treasury', requireFinanceOrAdmin, (req, res) => {
  res.json(getTreasury());
});

router.post('/treasury/entries', requireFinanceOrAdmin, (req, res) => {
  res.status(201).json(createTreasuryEntry(req.body, requestActorId(req)));
});

router.get('/invoices', requireFinanceOrAdmin, (req, res) => {
  res.json(listInvoices(req.query.kind));
});

router.post('/invoices/purchase', requireFinanceOrAdmin, (req, res) => {
  res.status(201).json(createPurchaseInvoice(req.body, requestActorId(req)));
});

router.post('/invoices/:id/receipt', requireFinanceOrAdmin, (req, res) => {
  res.status(201).json(recordSalesReceipt(req.params.id, req.body, requestActorId(req)));
});

router.post('/invoices/:id/payment', requireFinanceOrAdmin, (req, res) => {
  res.status(201).json(recordPurchasePayment(req.params.id, req.body, requestActorId(req)));
});

export default router;

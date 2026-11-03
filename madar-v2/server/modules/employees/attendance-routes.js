import { Router } from 'express';
import { requestActorId } from '../actor.js';
import { allowOnlyKeys, positiveId, requireObject } from '../http.js';
import {
  clockInForEmployee,
  clockOutForEmployee,
  getAttendanceBusinessDate,
  listPendingOvertime,
  reviewOvertime,
} from './attendance.js';

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access is required.' });
    return;
  }
  next();
}

router.get('/pending-overtime', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ records: listPendingOvertime() });
});

router.get('/today', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ date: getAttendanceBusinessDate() });
});

router.post('/mark', requireAdmin, (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['employeeId']);
  const attendance = clockInForEmployee(positiveId(body.employeeId, 'employeeId'), requestActorId(req));
  res.status(201).json({ success: true, attendance });
});

router.post('/clock-out', requireAdmin, (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['employeeId']);
  const attendance = clockOutForEmployee(positiveId(body.employeeId, 'employeeId'), requestActorId(req));
  res.json({ success: true, attendance });
});

router.post('/:id/approve-overtime', requireAdmin, (req, res) => {
  const attendance = reviewOvertime(req.params.id, 'approved', requestActorId(req));
  res.json({ success: true, attendance });
});

router.post('/:id/reject-overtime', requireAdmin, (req, res) => {
  const attendance = reviewOvertime(req.params.id, 'rejected', requestActorId(req));
  res.json({ success: true, attendance });
});

export default router;

import { Router } from 'express';
import { requestActorId } from '../actor.js';
import { allowOnlyKeys, positiveId, requireObject } from '../http.js';
import { publishOperationsEvent } from '../operations-events.js';
import { requireFinanceOrAdmin } from '../auth/authorization.js';
import { db } from '../../database/connection.js';
import {
  clockInForEmployee,
  clockOutForEmployee,
  cancelDailyAttendance,
  getAttendanceBusinessDate,
  getAttendanceBusinessTimeZone,
  getOverdueAttendance,
  listOvertimeRequests,
  listPendingOvertime,
  reviewOvertime,
  reviewOvertimeRequest,
} from './attendance.js';

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access is required.' });
    return;
  }
  next();
}

router.get('/pending-overtime', requireFinanceOrAdmin, (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ records: listPendingOvertime() });
});

router.get('/overtime-requests', requireFinanceOrAdmin, (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, requests: listOvertimeRequests(req.query.status ?? 'pending') });
});

router.post('/overtime-requests/:id/approve', requireFinanceOrAdmin, (req, res) => {
  const body = requireObject(req.body ?? {});
  allowOnlyKeys(body, ['note']);
  const request = reviewOvertimeRequest(req.params.id, 'approved', requestActorId(req), undefined, {
    note: body.note,
  });
  publishOperationsEvent('overtime.reviewed', {
    requestId: request.id,
    employeeId: request.employee_id,
    employeeName: request.employee_name,
    workDate: request.work_date,
    decision: 'approved',
    userId: request.requested_by,
    recipientUserIds: [Number(request.requested_by)],
  });
  res.set({ 'Cache-Control': 'private, no-store' });
  res.json({ success: true, request });
});

router.post('/overtime-requests/:id/reject', requireFinanceOrAdmin, (req, res) => {
  const body = requireObject(req.body ?? {});
  allowOnlyKeys(body, ['note']);
  const request = reviewOvertimeRequest(req.params.id, 'rejected', requestActorId(req), undefined, {
    note: body.note,
  });
  publishOperationsEvent('overtime.reviewed', {
    requestId: request.id,
    employeeId: request.employee_id,
    employeeName: request.employee_name,
    workDate: request.work_date,
    decision: 'rejected',
    userId: request.requested_by,
    recipientUserIds: [Number(request.requested_by)],
  });
  res.set({ 'Cache-Control': 'private, no-store' });
  res.json({ success: true, request });
});

router.get('/today', requireAdmin, (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  const now = new Date();
  res.json({
    date: getAttendanceBusinessDate(undefined, now),
    timeZone: getAttendanceBusinessTimeZone(),
    asOf: now.toISOString(),
    overdue: getOverdueAttendance(undefined, now),
  });
});

router.post('/mark', requireAdmin, (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['employeeId']);
  const attendance = clockInForEmployee(positiveId(body.employeeId, 'employeeId'), requestActorId(req));
  publishOperationsEvent('attendance.changed', {
    employeeId: attendance.employee_id,
    workDate: attendance.work_date,
    actorId: requestActorId(req),
  });
  res.status(201).json({ success: true, attendance });
});

router.post('/clock-out', requireAdmin, (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['employeeId', 'clockOutLocal', 'adminNote']);
  const attendance = clockOutForEmployee(positiveId(body.employeeId, 'employeeId'), requestActorId(req), undefined, {
    clockOutLocal: body.clockOutLocal,
    adminNote: body.adminNote,
  });
  publishOperationsEvent('attendance.changed', {
    employeeId: attendance.employee_id,
    workDate: attendance.work_date,
    actorId: requestActorId(req),
  });
  if (attendance.overtime_status === 'pending' && Number(attendance.overtime_hours) > 0) {
    publishOperationsEvent('overtime.pending', {
      employeeId: attendance.employee_id,
      employeeName: attendance.name,
      workDate: attendance.work_date,
      overtimeHours: Number(attendance.overtime_hours),
    });
  }
  res.json({ success: true, attendance });
});

router.post('/cancel', requireFinanceOrAdmin, (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['employeeId', 'workDate']);
  const attendance = cancelDailyAttendance(positiveId(body.employeeId, 'employeeId'), body.workDate, requestActorId(req));
  const linkedUserId = db.prepare('SELECT user_id FROM employees WHERE id = ?').get(attendance.employee_id)?.user_id;
  publishOperationsEvent('attendance.changed', {
    employeeId: attendance.employee_id,
    workDate: attendance.work_date,
    action: 'cancelled',
    actorId: requestActorId(req),
    ...(linkedUserId ? { userId: Number(linkedUserId), recipientUserIds: [Number(linkedUserId)] } : {}),
  });
  res.json({ success: true, attendance });
});

router.post('/:id/approve-overtime', requireFinanceOrAdmin, (req, res) => {
  const attendance = reviewOvertime(req.params.id, 'approved', requestActorId(req));
  publishOperationsEvent('overtime.reviewed', { attendanceId: attendance.id, decision: 'approved' });
  res.json({ success: true, attendance });
});

router.post('/:id/reject-overtime', requireFinanceOrAdmin, (req, res) => {
  const attendance = reviewOvertime(req.params.id, 'rejected', requestActorId(req));
  publishOperationsEvent('overtime.reviewed', { attendanceId: attendance.id, decision: 'rejected' });
  res.json({ success: true, attendance });
});

export default router;

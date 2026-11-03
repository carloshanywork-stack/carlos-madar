import { Router } from 'express';
import { requestActorId } from '../actor.js';
import { publishOperationsEvent } from '../operations-events.js';
import { buildMonthlyAttendanceWorkbook } from './attendance-export.js';
import {
  createEmployee,
  deactivateEmployee,
  finalizePayroll,
  getAttendance,
  getMonthlyAttendance,
  getPayroll,
  issueEmployeeTool,
  listEmployees,
  listEmployeeTools,
  returnEmployeeTool,
  saveAttendance,
  saveMonthlyAttendance,
  markAllPresent,
  updateEmployee,
} from './service.js';

const router = Router();

router.get('/', (req, res) => {
  const includeAll = req.query.all === '1';
  res.json(listEmployees(req.query.department, undefined, {
    includeInactive: includeAll,
    includeLoginUsers: includeAll,
  }));
});
router.post('/', (req, res) => {
  res.status(201).json(createEmployee(req.body, requestActorId(req)));
});
router.patch('/:id', (req, res) => {
  res.json(updateEmployee(req.params.id, req.body, requestActorId(req)));
});
router.delete('/:id', (req, res) => {
  res.json(deactivateEmployee(req.params.id, requestActorId(req)));
});

router.get('/attendance', (req, res) => {
  res.json(getAttendance(req.query.date));
});
router.get('/attendance/monthly', (req, res) => {
  res.json(getMonthlyAttendance(req.query.month));
});
router.post('/attendance/monthly', (req, res) => {
  const result = saveMonthlyAttendance(req.body, requestActorId(req));
  publishOperationsEvent('attendance.changed', { month: result.month, actorId: requestActorId(req) });
  res.json(result);
});
router.post('/attendance/mark-all-present', (req, res) => {
  const result = markAllPresent(req.body?.date, requestActorId(req));
  publishOperationsEvent('attendance.changed', { workDate: result.date, actorId: requestActorId(req) });
  res.json(result);
});
router.get('/attendance/export-monthly', (req, res) => {
  const month = req.query.month;
  const workbook = buildMonthlyAttendanceWorkbook(month);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="attendance-${month}.xlsx"; filename*=UTF-8''${encodeURIComponent(`كشف-الحضور-${month}.xlsx`)}`,
    'Cache-Control': 'private, no-store',
  }).send(workbook);
});
router.post('/attendance', (req, res) => {
  const result = saveAttendance(req.body, requestActorId(req));
  publishOperationsEvent('attendance.changed', { workDate: req.body?.date, actorId: requestActorId(req) });
  res.json(result);
});

router.get('/payroll', (req, res) => {
  res.json(getPayroll(req.query.month));
});
router.post('/payroll/finalize', (req, res) => {
  res.json(finalizePayroll(req.body, requestActorId(req)));
});

router.get('/:id/tools', (req, res) => {
  res.json(listEmployeeTools(req.params.id));
});
router.post('/:id/tools', (req, res) => {
  res.status(201).json(issueEmployeeTool(req.params.id, req.body, requestActorId(req)));
});
router.post('/tools/:toolId/return', (req, res) => {
  res.json(returnEmployeeTool(req.params.toolId, requestActorId(req)));
});

export default router;

import { Router } from 'express';
import { requestActorId } from '../actor.js';
import { isFinanceOrAdmin, requireFinanceOrAdmin } from '../auth/authorization.js';
import { publishOperationsEvent } from '../operations-events.js';
import { buildMonthlyAttendanceWorkbook } from './attendance-export.js';
import {
  createEmployee,
  createEmployeeAdvance,
  createPayrollAdjustment,
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

router.get('/', (req, res, next) => {
  const includeAll = req.query.all === '1';
  const employees = listEmployees(req.query.department, undefined, {
    includeInactive: includeAll,
    includeLoginUsers: includeAll,
  });
  if (isFinanceOrAdmin(req)) {
    res.json(employees);
    return;
  }
  res.json(employees.map((employee) => {
    const { base_salary_cents, monthly_salary_cents, daily_rate_cents, ...publicEmployee } = employee;
    return publicEmployee;
  }));
});
router.post('/', requireFinanceOrAdmin, (req, res) => {
  res.status(201).json(createEmployee(req.body, requestActorId(req)));
});
router.patch('/:id', requireFinanceOrAdmin, (req, res) => {
  res.json(updateEmployee(req.params.id, req.body, requestActorId(req)));
});
router.delete('/:id', requireFinanceOrAdmin, (req, res) => {
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
router.get('/attendance/export-monthly', requireFinanceOrAdmin, (req, res) => {
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

router.get('/payroll', requireFinanceOrAdmin, (req, res) => {
  res.json(getPayroll(req.query.month));
});
router.post('/payroll/finalize', requireFinanceOrAdmin, (req, res) => {
  res.json(finalizePayroll(req.body, requestActorId(req)));
});
router.post('/:id/advances', requireFinanceOrAdmin, (req, res) => {
  const advance = createEmployeeAdvance(req.params.id, req.body, requestActorId(req));
  publishOperationsEvent('payroll.changed', { employeeId: Number(req.params.id), month: advance.month_year, actorId: requestActorId(req) });
  res.status(201).json(advance);
});
router.post('/:id/payroll-adjustments', requireFinanceOrAdmin, (req, res) => {
  const adjustment = createPayrollAdjustment(req.params.id, req.body, requestActorId(req));
  publishOperationsEvent('payroll.changed', { employeeId: Number(req.params.id), month: adjustment.month_year, actorId: requestActorId(req) });
  res.status(201).json(adjustment);
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

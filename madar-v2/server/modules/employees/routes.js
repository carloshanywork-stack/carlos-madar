import { Router } from 'express';
import { requestActorId } from '../actor.js';
import {
  createEmployee,
  deactivateEmployee,
  finalizePayroll,
  getAttendance,
  getPayroll,
  issueEmployeeTool,
  listEmployees,
  listEmployeeTools,
  returnEmployeeTool,
  saveAttendance,
  updateEmployee,
} from './service.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listEmployees(req.query.department, undefined, { includeInactive: req.query.all === '1' }));
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
router.post('/attendance', (req, res) => {
  res.json(saveAttendance(req.body, requestActorId(req)));
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

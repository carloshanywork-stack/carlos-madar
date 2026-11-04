import { Router } from 'express';
import { requestActorId } from '../actor.js';
import { publishOperationsEvent } from '../operations-events.js';
import { asyncHandler } from '../http.js';
import { createStaffMember, listStaff, updateStaffMember } from './staff-service.js';

const router = Router();

router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access is required to manage staff.' });
    return;
  }
  next();
});

router.get('/', (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json(listStaff(req.query.category));
});

router.post('/', asyncHandler(async (req, res) => {
  const staff = await createStaffMember(req.body, requestActorId(req));
  publishOperationsEvent('staff.changed', { employeeId: staff.id, userId: staff.user_id, action: 'created' });
  res.status(201).json(staff);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const staff = await updateStaffMember(req.params.id, req.body, requestActorId(req));
  publishOperationsEvent('staff.changed', { employeeId: staff.id, userId: staff.user_id, action: 'updated' });
  res.json(staff);
}));

export default router;

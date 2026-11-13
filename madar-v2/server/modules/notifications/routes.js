import { Router } from 'express';
import {
  dismissNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from './service.js';

const router = Router();

router.use((_req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  next();
});

router.get('/', (req, res) => {
  res.json({ success: true, ...listNotificationsForUser(req.user.id) });
});

router.post('/read-all', (req, res) => {
  res.json({ success: true, ...markAllNotificationsRead(req.user.id) });
});

router.post('/:id/read', (req, res) => {
  res.json({ success: true, ...markNotificationRead(req.user.id, req.params.id) });
});

router.delete('/:id', (req, res) => {
  res.json({ success: true, ...dismissNotification(req.user.id, req.params.id) });
});

export default router;

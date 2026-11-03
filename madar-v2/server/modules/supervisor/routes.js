import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { asyncHandler, HttpError } from '../http.js';
import { requestActorId } from '../actor.js';
import {
  buildApprovedVisitsWorkbook,
  getPendingVisitReviews,
  getSupervisorRadar,
  getSupervisorVisitPhoto,
  reviewRepVisit,
} from './service.js';

const router = Router();

router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access is required for supervisor radar and visit review.' });
    return;
  }
  next();
});

router.get('/radar', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json(getSupervisorRadar());
});

router.get('/qa/queue', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, visits: getPendingVisitReviews() });
});

router.get('/visits/:id/photos/:phase', asyncHandler(async (req, res) => {
  const absolutePath = await getSupervisorVisitPhoto(req.params.id, req.params.phase);
  const contentType = req.params.phase === 'before' || req.params.phase === 'after' ? 'image/jpeg' : 'application/octet-stream';
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': contentType });
  res.send(await readFile(absolutePath));
}));

router.post('/visits/:id/review', (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'private, no-store' });
    res.json(reviewRepVisit(req.params.id, req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/reports/approved-visits.xlsx', asyncHandler(async (req, res) => {
  const day = req.query.day;
  if (day !== undefined && (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))) {
    throw new HttpError(400, 'day must be formatted YYYY-MM-DD.');
  }
  const buffer = buildApprovedVisitsWorkbook(day);
  const filename = `Madar-Approved-Visits-${day || new Date().toISOString().slice(0, 10)}.xlsx`;
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(`زيارات-معتمدة-${day || 'اليوم'}.xlsx`)}`,
    'Cache-Control': 'private, no-store',
  }).send(buffer);
}));

export default router;

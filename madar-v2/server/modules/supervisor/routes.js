import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { asyncHandler, HttpError } from '../http.js';
import { requestActorId } from '../actor.js';
import { getOfflineMapStatus, readOfflineMapTile } from './offline-tiles.js';
import { getOperationsEventsAfter, publishOperationsEvent, subscribeOperationsEvents } from '../operations-events.js';
import { approveRepMachineLocationCorrection, rejectRepMachineLocationCorrection, listLocationConfirmations } from '../rep/service.js';
import {
  buildApprovedVisitsWorkbook,
  getPendingVisitReviews,
  getSupervisorRadar,
  getSupervisorRepRoute,
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

router.get('/map/status', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json(getOfflineMapStatus());
});

router.get('/map/tiles/:z/:x/:y', (req, res) => {
  const tile = readOfflineMapTile(req.params.z, req.params.x, req.params.y);
  if (!tile) {
    res.status(204).end();
    return;
  }
  res.set({
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': tile.contentType,
  }).status(200).send(tile.data);
});

router.get('/events', (req, res) => {
  const cursor = Number(req.get('Last-Event-ID') ?? req.query.lastEventId ?? 0);
  const safeCursor = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  res.status(200).set({
    'Cache-Control': 'private, no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  let lastEventId = safeCursor;
  const dispatch = (event) => {
    const eventId = Number(event.id);
    if (Number.isSafeInteger(eventId) && eventId <= lastEventId) return;
    if (Number.isSafeInteger(eventId)) lastEventId = eventId;
    res.write(`id: ${event.id}\nevent: operations\ndata: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'system.shutdown') res.end();
  };
  for (const event of getOperationsEventsAfter(safeCursor, { limit: 10_000 })) dispatch(event);

  const unsubscribe = subscribeOperationsEvents(dispatch);
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25_000);
  heartbeat.unref?.();
  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  res.once('close', close);
  res.once('error', close);
});

router.get('/radar', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json(getSupervisorRadar());
});

router.get('/reps/:id/route', (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    res.json(getSupervisorRepRoute(req.params.id, req.query.date));
  } catch (error) {
    next(error);
  }
});

router.get('/location-confirmations', (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store' });
  res.json({ success: true, requests: listLocationConfirmations({ status: req.query.status ?? 'pending' }) });
});

router.post('/corrections/:id/reject', (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'private, no-store' });
    res.json(rejectRepMachineLocationCorrection(req.params.id, req.body, requestActorId(req)));
  } catch (error) { next(error); }
});

router.post('/corrections/:id/approve', (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'private, no-store' });
    res.json(approveRepMachineLocationCorrection(req.params.id, req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/qa/queue', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, visits: getPendingVisitReviews() });
});

const sendVisitPhoto = asyncHandler(async (req, res) => {
  const absolutePath = await getSupervisorVisitPhoto(req.params.id, req.params.phase, req.params.ordinal);
  const contentType = req.params.phase === 'before' || req.params.phase === 'after' ? 'image/jpeg' : 'application/octet-stream';
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': contentType });
  res.send(await readFile(absolutePath));
});
router.get('/visits/:id/photos/:phase', sendVisitPhoto);
router.get('/visits/:id/photos/:phase/:ordinal', sendVisitPhoto);

router.post('/visits/:id/review', (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'private, no-store' });
    const result = reviewRepVisit(req.params.id, req.body, requestActorId(req));
    publishOperationsEvent('rep.visit.reviewed', {
      userId: result.repUserId,
      visitId: result.visitId,
      status: result.status,
    });
    res.json(result);
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

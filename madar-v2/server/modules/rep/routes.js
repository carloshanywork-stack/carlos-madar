import { Router } from 'express';
import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import { asyncHandler, allowOnlyKeys, HttpError, requireObject, requireText } from '../http.js';
import { diskUploadMany, memoryUpload } from '../upload.js';
import { ensureStorageDirectory, removeStorageFile } from '../storage.js';
import { publishOperationsEvent, subscribeOperationsEvents } from '../operations-events.js';
import { loginRateLimiter } from '../auth/login-rate-limit.js';
import { getOfflineMapPackCatalog, getOfflineMapPackManifest, readOfflineMapPackTile } from '../supervisor/offline-tiles.js';
import { clockInForRep, clockOutForRep, getTodayAttendanceForRep } from '../employees/attendance.js';
import {
  authenticateRepUser,
  authCookieOptions,
  REP_ACCOUNT_DISABLED_MESSAGE,
  requireActiveRep,
} from '../auth/service.js';
import {
  getRepFaultReasons,
  getRepTodayRoute,
  confirmRepMachineLocation,
  requireRepUsername,
  submitRepMachineCorrection,
  syncRepLocationPing,
  syncRepTracking,
  syncRepVisit,
} from './service.js';

const router = Router();
const syncVisitUpload = diskUploadMany({
  maxBytes: 3 * 1024 * 1024,
  extensions: ['.jpg', '.jpeg', '.webp'],
  destination: () => ensureStorageDirectory('.incoming'),
});
const machineCorrectionUpload = memoryUpload({
  maxBytes: 4 * 1024 * 1024,
  extensions: ['.jpg', '.jpeg', '.png', '.webp'],
}).single('evidence');

function setSessionCookie(req, res, token) {
  res.cookie(env.authCookieName, token, {
    ...authCookieOptions(req),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.post('/login', loginRateLimiter, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['username', 'password']);
  const username = requireText(body.username, 'Username', { minLength: 1, maxLength: 64 });
  if (typeof body.password !== 'string' || !body.password || body.password.length > 1024) {
    throw new HttpError(400, 'Username and password are required.');
  }

  const result = authenticateRepUser(username, body.password, db);
  if (result?.disabled) {
    res.clearCookie(env.authCookieName, authCookieOptions(req));
    res.status(403).json({ success: false, message: REP_ACCOUNT_DISABLED_MESSAGE });
    return;
  }
  if (!result) {
    res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    return;
  }

  setSessionCookie(req, res, result.token);
  const response = { success: true, rep: result.user };
  // Only the native Android client needs the bearer credential for WorkManager jobs.
  // Browser sessions continue to use the HttpOnly cookie exclusively.
  if (req.get('x-madar-native-client') === 'android') response.token = result.token;
  res.json(response);
}));

router.use(requireActiveRep);

router.get('/events', (req, res) => {
  const repId = Number(req.user.id);
  res.status(200).set({
    'Cache-Control': 'private, no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  const unsubscribe = subscribeOperationsEvents((event) => {
    if (event.type === 'system.shutdown') {
      res.write(`id: ${event.id}\nevent: operations\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
      return;
    }
    const recipients = Array.isArray(event.recipientUserIds) ? event.recipientUserIds.map(Number) : [];
    const isDirectRecipient = Number(event.userId) === repId;
    if (!recipients.includes(repId) && !isDirectRecipient) return;
    res.write(`id: ${event.id}\nevent: operations\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25_000);
  heartbeat.unref?.();
  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  res.once('close', close);
  res.once('error', close);
});

router.get('/attendance/today', (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, ...getTodayAttendanceForRep(req.user.id) });
});

router.post('/attendance/clock-in', (req, res) => {
  const attendance = clockInForRep(req.user.id, req.body);
  publishOperationsEvent('attendance.changed', {
    userId: req.user.id,
    employeeId: attendance.employee_id,
    workDate: attendance.work_date,
  });
  res.status(201).json({ success: true, attendance });
});

router.post('/attendance/clock-out', (req, res) => {
  const attendance = clockOutForRep(req.user.id, req.body);
  publishOperationsEvent('attendance.changed', {
    userId: req.user.id,
    employeeId: attendance.employee_id,
    workDate: attendance.work_date,
  });
  if (attendance.overtime_status === 'pending' && Number(attendance.overtime_hours) > 0) {
    publishOperationsEvent('overtime.pending', {
      userId: req.user.id,
      employeeId: attendance.employee_id,
      employeeName: attendance.name,
      workDate: attendance.work_date,
      overtimeHours: Number(attendance.overtime_hours),
    });
  }
  res.json({ success: true, attendance });
});

router.get('/today-route', (req, res, next) => {
  try {
    requireRepUsername(req.query.username, req.user.username);
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    res.json(getRepTodayRoute(req.user));
  } catch (error) {
    next(error);
  }
});

router.post('/machines/:machineId/confirm-location', (req, res, next) => {
  try {
    const result = confirmRepMachineLocation(req.user, req.params.machineId, req.body);
    if (!result.idempotent) {
      publishOperationsEvent('rep.machine.location-confirmed', {
        userId: req.user.id,
        machineId: result.machine.id,
        machineCode: result.machine.code,
        verificationId: result.verificationId,
      });
    }
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) { next(error); }
});

router.post('/machines/:machineId/corrections', machineCorrectionUpload, asyncHandler(async (req, res) => {
  let correction;
  try {
    correction = JSON.parse(req.body?.correction ?? '');
  } catch {
    throw new HttpError(400, 'correction must contain valid JSON.');
  }
  const result = await submitRepMachineCorrection(req.user, req.params.machineId, correction, req.file);
  if (!result.idempotent) {
    publishOperationsEvent('rep.machine.correction-submitted', {
      userId: req.user.id,
      machineId: Number(req.params.machineId),
      correctionId: result.correctionId,
      reportedCode: correction.reportedCode,
      codeConflict: result.codeConflict,
    });
  }
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.status(result.idempotent ? 200 : 201).json(result);
}));

router.get('/fault-reasons', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json(getRepFaultReasons());
});

router.get('/map/packs', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, packs: getOfflineMapPackCatalog() });
});

router.get('/map/packs/:packId/manifest', (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    res.json({ success: true, pack: getOfflineMapPackManifest(req.params.packId) });
  } catch (error) {
    next(error);
  }
});

router.get('/map/tiles/:packId/:z/:x/:y', (req, res, next) => {
  try {
    const tile = readOfflineMapPackTile(req.params.packId, req.params.z, req.params.x, req.params.y);
    if (!tile) {
      res.status(204).end();
      return;
    }
    res.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': tile.contentType,
    }).status(200).send(tile.data);
  } catch (error) {
    next(error);
  }
});

router.post(['/tracking', '/track-location'], (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    const result = syncRepTracking(req.user, req.body);
    publishOperationsEvent('rep.tracking.updated', {
      userId: req.user.id,
      acceptedPoints: result.acceptedPoints,
      onDuty: result.onDuty,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post('/location-ping', (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    const result = syncRepLocationPing(req.user, req.body);
    publishOperationsEvent('rep.tracking.updated', {
      userId: req.user.id,
      acceptedPoints: result.acceptedPoints,
      onDuty: result.onDuty,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post('/sync-visit', syncVisitUpload.any(), asyncHandler(async (req, res) => {
  try {
    let visit;
    try {
      visit = JSON.parse(req.body?.visit ?? '');
    } catch {
      throw new HttpError(400, 'visit must contain valid JSON.');
    }
    const files = req.files ?? [];
    if (files.some((file) => !['beforePhoto', 'afterPhoto'].includes(file.fieldname))) {
      throw new HttpError(400, 'Visit photos must use beforePhoto or afterPhoto fields.');
    }
    const result = await syncRepVisit(req.user, visit, {
      beforePhotos: files.filter((file) => file.fieldname === 'beforePhoto'),
      afterPhotos: files.filter((file) => file.fieldname === 'afterPhoto'),
    });
    if (result.status !== 'processing') {
      publishOperationsEvent('rep.visit.submitted', {
        userId: req.user.id,
        visitUuid: result.visitUuid,
        status: result.status,
      });
    }
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    res.status(result.status === 'processing' ? 202 : 200).json(result);
  } finally {
    await Promise.all((req.files ?? []).map((file) => removeStorageFile(file.path).catch(() => undefined)));
  }
}));

export default router;

import { Router } from 'express';
import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import { asyncHandler, allowOnlyKeys, HttpError, requireObject, requireText } from '../http.js';
import { diskUploadMany } from '../upload.js';
import { ensureStorageDirectory, removeStorageFile } from '../storage.js';
import {
  authenticateRepUser,
  authCookieOptions,
  REP_ACCOUNT_DISABLED_MESSAGE,
  requireActiveRep,
} from '../auth/service.js';
import { getRepFaultReasons, getRepTodayRoute, requireRepUsername, syncRepTracking, syncRepVisit } from './service.js';

const router = Router();
const syncVisitUpload = diskUploadMany({
  maxBytes: 3 * 1024 * 1024,
  extensions: ['.jpg', '.jpeg', '.webp'],
  destination: () => ensureStorageDirectory('.incoming'),
});

function setSessionCookie(res, token) {
  res.cookie(env.authCookieName, token, {
    ...authCookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.post('/login', asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['username', 'password']);
  const username = requireText(body.username, 'Username', { minLength: 1, maxLength: 64 });
  if (typeof body.password !== 'string' || !body.password || body.password.length > 1024) {
    throw new HttpError(400, 'Username and password are required.');
  }

  const result = authenticateRepUser(username, body.password, db);
  if (result?.disabled) {
    res.clearCookie(env.authCookieName, authCookieOptions());
    res.status(403).json({ success: false, message: REP_ACCOUNT_DISABLED_MESSAGE });
    return;
  }
  if (!result) {
    res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    return;
  }

  setSessionCookie(res, result.token);
  res.json({ success: true, rep: result.user });
}));

router.use(requireActiveRep);

router.get('/today-route', (req, res, next) => {
  try {
    requireRepUsername(req.query.username, req.user.username);
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    res.json(getRepTodayRoute(req.user));
  } catch (error) {
    next(error);
  }
});

router.get('/fault-reasons', (_req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json(getRepFaultReasons());
});

router.post(['/tracking', '/track-location'], (req, res, next) => {
  try {
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    res.json({ success: true, ...syncRepTracking(req.user, req.body) });
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
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
    res.status(result.status === 'processing' ? 202 : 200).json(result);
  } finally {
    await Promise.all((req.files ?? []).map((file) => removeStorageFile(file.path).catch(() => undefined)));
  }
}));

export default router;

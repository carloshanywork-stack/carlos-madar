import { Router } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import { asyncHandler, allowOnlyKeys, HttpError, requireObject, requireText } from '../http.js';
import { authenticateUser, authCookieOptions, requireAuthentication } from '../auth/service.js';
import { getRepFaultReasons, getRepTodayRoute, requireRepUsername, syncRepTracking, syncRepVisit } from './service.js';

const router = Router();
const syncVisitUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 2, fields: 1, fieldSize: 64 * 1024, parts: 3 },
  fileFilter(_req, file, callback) {
    if (!['image/jpeg', 'image/webp'].includes(file.mimetype)) {
      callback(new HttpError(400, 'Visit photos must be JPEG or WebP images.'));
      return;
    }
    callback(null, true);
  },
}).fields([
  { name: 'beforePhoto', maxCount: 1 },
  { name: 'afterPhoto', maxCount: 1 },
]);

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

  const result = authenticateUser(username, body.password, db, { allowedRoles: ['rep'] });
  if (!result) {
    res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    return;
  }

  setSessionCookie(res, result.token);
  res.json({ success: true, rep: result.user });
}));

router.use(requireAuthentication);
router.use((req, res, next) => {
  if (req.user?.role !== 'rep') {
    res.status(403).json({ error: 'Field representative access is required.' });
    return;
  }
  next();
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

router.post('/sync-visit', syncVisitUpload, asyncHandler(async (req, res) => {
  let visit;
  try {
    visit = JSON.parse(req.body?.visit ?? '');
  } catch {
    throw new HttpError(400, 'visit must contain valid JSON.');
  }
  const result = await syncRepVisit(req.user, visit, {
    beforePhoto: req.files?.beforePhoto?.[0],
    afterPhoto: req.files?.afterPhoto?.[0],
  });
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.status(result.status === 'processing' ? 202 : 200).json(result);
}));

export default router;

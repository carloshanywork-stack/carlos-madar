import { Router } from 'express';
import { asyncHandler, allowOnlyKeys, HttpError, requireObject, requireText } from '../http.js';
import {
  authCookieOptions,
  createFirstAdmin,
  createSession,
  getSessionUserFromRequest,
  isDisabledRepSessionFromRequest,
  getTokenFromRequest,
  isSetupRequired,
  refreshRepPresence,
  revokeSession,
  authenticateUser,
  REP_ACCOUNT_DISABLED_MESSAGE,
} from './service.js';
import { env } from '../../config/env.js';
import { syncRepTracking } from '../rep/service.js';
import { loginRateLimiter } from './login-rate-limit.js';

const router = Router();

function setSessionCookie(req, res, token) {
  res.cookie(env.authCookieName, token, {
    ...authCookieOptions(req),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.get('/status', (req, res) => {
  const user = getSessionUserFromRequest(req);
  const status = {
    authenticated: Boolean(user),
    user,
    setupRequired: isSetupRequired(),
  };
  if (!user && isDisabledRepSessionFromRequest(req)) status.message = REP_ACCOUNT_DISABLED_MESSAGE;
  res.json(status);
});

router.post('/setup', asyncHandler(async (req, res) => {
  const user = await createFirstAdmin(req.body);
  const token = createSession(user);
  setSessionCookie(req, res, token);
  res.status(201).json({ authenticated: true, user, setupRequired: false });
}));

router.post('/login', loginRateLimiter, asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['username', 'password']);
  const username = requireText(body.username, 'Username', { minLength: 1, maxLength: 64 });
  const password = body.password;
  if (typeof password !== 'string' || !password || password.length > 1024) {
    throw new HttpError(400, 'Username and password are required.');
  }
  const result = authenticateUser(username, password, undefined, {
    allowedRoles: ['admin', 'sales', 'operations', 'purchasing'],
  });
  if (!result) {
    res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    return;
  }
  const { user, token } = result;
  setSessionCookie(req, res, token);
  res.json({ ok: true, user, token });
}));

router.post('/logout', (req, res) => {
  const user = getSessionUserFromRequest(req);
  if (user?.role === 'rep') syncRepTracking(user, { onDuty: false });
  revokeSession(getTokenFromRequest(req));
  if (user?.role === 'rep') refreshRepPresence(user.id);
  res.clearCookie(env.authCookieName, authCookieOptions(req));
  res.json({ ok: true });
});

export default router;

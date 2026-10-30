import { Router } from 'express';
import { asyncHandler, allowOnlyKeys, HttpError, requireObject, requireText } from '../http.js';
import {
  authCookieOptions,
  createFirstAdmin,
  createSession,
  getSessionUserFromRequest,
  getTokenFromRequest,
  isSetupRequired,
  revokeSession,
  authenticateUser,
} from './service.js';
import { env } from '../../config/env.js';

const router = Router();

function setSessionCookie(res, token) {
  res.cookie(env.authCookieName, token, {
    ...authCookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.get('/status', (req, res) => {
  const user = getSessionUserFromRequest(req);
  res.json({
    authenticated: Boolean(user),
    user,
    setupRequired: isSetupRequired(),
  });
});

router.post('/setup', asyncHandler(async (req, res) => {
  const user = await createFirstAdmin(req.body);
  const token = createSession(user);
  setSessionCookie(res, token);
  res.status(201).json({ authenticated: true, user, setupRequired: false });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['username', 'password']);
  const username = requireText(body.username, 'Username', { minLength: 1, maxLength: 64 });
  const password = body.password;
  if (typeof password !== 'string' || !password || password.length > 1024) {
    throw new HttpError(400, 'Username and password are required.');
  }
  const result = authenticateUser(username, password);
  if (!result) {
    res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    return;
  }
  const { user, token } = result;
  setSessionCookie(res, token);
  res.json({ ok: true, user, token });
}));

router.post('/logout', (req, res) => {
  revokeSession(getTokenFromRequest(req));
  res.clearCookie(env.authCookieName, authCookieOptions());
  res.json({ ok: true });
});

export default router;

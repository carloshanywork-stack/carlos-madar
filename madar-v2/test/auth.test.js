import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-auth-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'auth.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

const [{ app }, { db }, { initializeDatabase }, { verifyToken, authenticateUser }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/auth/service.js'),
]);

initializeDatabase({ initialAdminPassword: '' });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, options = {}, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  return {
    response,
    body: await response.json(),
    setCookie: response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? '',
  };
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function cookieValue(setCookie) {
  const value = setCookie.split(';', 1)[0];
  return value.startsWith('madar_token=') ? value : '';
}

test('auth status, one-time setup, protected APIs, login and revocable sessions', async () => {
  const initialStatus = await request('/api/auth/status');
  assert.equal(initialStatus.response.status, 200);
  assert.deepEqual(initialStatus.body, { authenticated: false, user: null, setupRequired: true });

  const anonymousBusinessRequest = await request('/api/clients');
  assert.equal(anonymousBusinessRequest.response.status, 401);

  const weakSetup = await request('/api/auth/setup', jsonOptions('POST', {
    fullName: 'Root Administrator',
    username: 'root',
    password: '123',
  }));
  assert.equal(weakSetup.response.status, 400);
  assert.equal((await request('/api/auth/status')).body.setupRequired, true);

  const setup = await request('/api/auth/setup', jsonOptions('POST', {
    fullName: 'Root Administrator',
    username: 'root',
    password: '1234',
  }));
  assert.equal(setup.response.status, 201);
  assert.deepEqual(setup.body, {
    authenticated: true,
    user: { id: 1, username: 'root', fullName: 'Root Administrator', role: 'admin' },
    setupRequired: false,
  });
  assert.match(setup.setCookie, /HttpOnly/i);
  assert.match(setup.setCookie, /SameSite=Strict/i);
  assert.match(setup.setCookie, /Path=\//i);
  const setupCookie = cookieValue(setup.setCookie);
  assert.ok(setupCookie);

  const authenticatedStatus = await request('/api/auth/status', {}, setupCookie);
  assert.equal(authenticatedStatus.body.authenticated, true);
  assert.equal(authenticatedStatus.body.user.username, 'root');
  assert.equal(authenticatedStatus.body.setupRequired, false);
  const authorizedBusinessRequest = await request('/api/clients', {}, setupCookie);
  assert.equal(authorizedBusinessRequest.response.status, 200);
  assert.deepEqual(authorizedBusinessRequest.body, []);

  const secondSetup = await request('/api/auth/setup', jsonOptions('POST', {
    fullName: 'Another Admin',
    username: 'another',
    password: 'Another-Admin-Password-2026!',
  }));
  assert.equal(secondSetup.response.status, 409);

  const failedLogin = await request('/api/auth/login', jsonOptions('POST', {
    username: 'root',
    password: 'incorrect-password',
  }));
  assert.equal(failedLogin.response.status, 401);
  assert.equal(failedLogin.body.error, 'اسم المستخدم أو كلمة المرور غير صحيحة');

  const login = await request('/api/auth/login', jsonOptions('POST', {
    username: 'ROOT',
    password: '1234',
  }));
  assert.equal(login.response.status, 200);
  assert.deepEqual(login.body, {
    ok: true,
    user: { id: 1, username: 'root', fullName: 'Root Administrator', role: 'admin' },
    token: login.body.token,
  });
  assert.equal(typeof login.body.token, 'string');
  assert.deepEqual(verifyToken(login.body.token), login.body.user);
  assert.equal(verifyToken('not-a-jwt'), null);
  const loginCookie = cookieValue(login.setCookie);
  assert.ok(loginCookie);
  assert.equal(decodeURIComponent(loginCookie.slice('madar_token='.length)), login.body.token);

  const bearerStatus = await request('/api/auth/status', {
    headers: { authorization: `Bearer ${login.body.token}` },
  });
  assert.equal(bearerStatus.body.authenticated, true);
  assert.equal((await request('/api/clients', {
    headers: { authorization: `Bearer ${login.body.token}` },
  })).response.status, 200);

  const logout = await request('/api/auth/logout', { method: 'POST' }, loginCookie);
  assert.equal(logout.response.status, 200);
  assert.deepEqual(logout.body, { ok: true });
  assert.match(logout.setCookie, /madar_token=;/);
  assert.equal((await request('/api/clients', {}, loginCookie)).response.status, 401);
  const token = decodeURIComponent(loginCookie.slice('madar_token='.length));
  const tokenHash = createHash('sha256').update(token).digest('hex');
  assert.ok(db.prepare('SELECT revoked_at FROM sessions WHERE token_hash = ?').get(tokenHash)?.revoked_at);
  assert.equal(verifyToken(token), null);
  assert.equal((await request('/api/auth/status', {
    headers: { authorization: `Bearer ${token}` },
  })).body.authenticated, false);

  const relogin = await request('/api/auth/login', jsonOptions('POST', {
    username: 'root',
    password: '1234',
  }));
  const reloginCookie = cookieValue(relogin.setCookie);
  db.prepare('UPDATE users SET active = 0 WHERE username = ?').run('root');
  const disabledSession = await request('/api/auth/status', {}, reloginCookie);
  assert.equal(disabledSession.body.authenticated, false);
  assert.equal(disabledSession.body.setupRequired, false);
  assert.equal((await request('/api/clients', {}, reloginCookie)).response.status, 401);
});

test('five consecutive account failures lock for 15 minutes and a later valid login resets the counter', () => {
  const passwordHash = bcrypt.hashSync('Lockout-Password-2026!', 12);
  const userId = Number(db.prepare(`INSERT INTO users (username, password_hash, full_name, role)
    VALUES ('lockout-user', ?, 'Lockout User', 'admin')`).run(passwordHash).lastInsertRowid);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal(authenticateUser('lockout-user', `wrong-${attempt}`), null);
  }
  const locked = db.prepare('SELECT failed_login_attempts, locked_until FROM users WHERE id = ?').get(userId);
  assert.equal(locked.failed_login_attempts, 5);
  assert.ok(Date.parse(locked.locked_until) > Date.now() + 14 * 60 * 1000);
  assert.equal(authenticateUser('lockout-user', 'Lockout-Password-2026!'), null, 'a correct password is rejected during the lockout window');
  assert.equal(db.prepare('SELECT failed_login_attempts FROM users WHERE id = ?').get(userId).failed_login_attempts, 5);

  db.prepare('UPDATE users SET locked_until = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), userId);
  const successful = authenticateUser('lockout-user', 'Lockout-Password-2026!');
  assert.equal(successful.user.username, 'lockout-user');
  assert.deepEqual(db.prepare('SELECT failed_login_attempts, locked_until FROM users WHERE id = ?').get(userId), {
    failed_login_attempts: 0,
    locked_until: null,
  });
});

test('both login endpoints share a five-failure-per-IP limiter with the requested Arabic message', async () => {
  const failures = [
    ['/api/auth/login', 'unknown-user-a'],
    ['/api/auth/login', 'unknown-user-b'],
    ['/api/auth/login', 'unknown-user-c'],
    ['/api/rep/login', 'unknown-user-d'],
  ];
  for (const [path, username] of failures) {
    const failed = await request(path, jsonOptions('POST', { username, password: 'wrong-password' }));
    assert.equal(failed.response.status, 401);
  }
  const blocked = await request('/api/auth/login', jsonOptions('POST', {
    username: 'unknown-user-e', password: 'wrong-password',
  }));
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.body.error, 'تم تجاوز الحد المسموح من محاولات الدخول. يرجى الانتظار لمدة دقيقة.');
});

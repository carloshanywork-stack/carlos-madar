import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '@madar/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../../lib/auth.js';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from '../../lib/cookies.js';
import { parseBody } from '../../lib/validation.js';
import {
  disableMfa,
  enableMfa,
  getMfaStatus,
  getProfile,
  login,
  logout,
  refresh,
  register,
  regenerateRecoveryCodes,
  setupMfa,
  verifyMfaLogin,
} from './service.js';

const emailSchema = z.string().trim().email().max(320);
const passwordSchema = z.string().min(12).max(200);

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120),
  workspaceName: z.string().trim().min(1).max(120),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

const mfaCodeSchema = z.string().trim().min(6).max(64);

const mfaVerifySchema = z.object({
  challengeToken: z.string().min(20),
  code: mfaCodeSchema,
});

const mfaEnableSchema = z.object({ code: mfaCodeSchema });

const mfaDisableSchema = z.object({
  password: z.string().min(1).max(200),
  code: mfaCodeSchema,
});

function requestMeta(request: FastifyRequest): { userAgent?: string; ip?: string } {
  return { userAgent: request.headers['user-agent'], ip: request.ip };
}

const authRateLimit = {
  config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
};

export async function authRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/register', authRateLimit, async (request, reply) => {
    const input = parseBody(registerSchema, request.body);
    const result = await register(deps, { ...input, ...requestMeta(request) });
    setRefreshCookie(reply, deps.env, result.refreshToken);
    return reply.code(201).send({
      accessToken: result.accessToken,
      user: result.user,
      workspace: result.workspace,
      mfaSetupRequired: true,
    });
  });

  app.post('/login', authRateLimit, async (request, reply) => {
    const input = parseBody(loginSchema, request.body);
    const result = await login(deps, { ...input, ...requestMeta(request) });
    if (result.mfaRequired) {
      return reply.code(200).send({
        mfaRequired: true,
        challengeToken: result.challengeToken,
        user: result.user,
      });
    }
    setRefreshCookie(reply, deps.env, result.refreshToken);
    return reply.code(200).send({
      accessToken: result.accessToken,
      user: result.user,
      mfaSetupRequired: result.mfaSetupRequired,
    });
  });

  app.post('/mfa/verify', authRateLimit, async (request, reply) => {
    const input = parseBody(mfaVerifySchema, request.body);
    const result = await verifyMfaLogin(deps, { ...input, ...requestMeta(request) });
    setRefreshCookie(reply, deps.env, result.refreshToken);
    return reply.code(200).send({
      accessToken: result.accessToken,
      user: result.user,
      mfaMethod: result.mfaMethod,
    });
  });

  app.get('/mfa/status', async (request) => {
    const user = await requireUser(request, deps);
    return getMfaStatus(deps, user.id);
  });

  app.post('/mfa/setup', async (request) => {
    const user = await requireUser(request, deps);
    return setupMfa(deps, user.id);
  });

  app.post('/mfa/enable', authRateLimit, async (request) => {
    const user = await requireUser(request, deps);
    const input = parseBody(mfaEnableSchema, request.body);
    return enableMfa(deps, user.id, input.code);
  });

  app.post('/mfa/disable', authRateLimit, async (request) => {
    const user = await requireUser(request, deps);
    const input = parseBody(mfaDisableSchema, request.body);
    return disableMfa(deps, user.id, input);
  });

  app.post('/mfa/recovery-codes/regenerate', authRateLimit, async (request) => {
    const user = await requireUser(request, deps);
    const input = parseBody(mfaEnableSchema, request.body);
    return regenerateRecoveryCodes(deps, user.id, input.code);
  });

  app.post('/refresh', authRateLimit, async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) throw AppError.unauthorized('invalid_token', 'Missing refresh token');

    const result = await refresh(deps, token, requestMeta(request));
    setRefreshCookie(reply, deps.env, result.refreshToken);
    return reply.code(200).send({ accessToken: result.accessToken, user: result.user });
  });

  app.post('/logout', async (request, reply) => {
    await logout(deps, request.cookies[REFRESH_COOKIE]);
    clearRefreshCookie(reply, deps.env);
    return reply.code(200).send({ ok: true });
  });

  app.get('/me', async (request) => {
    const user = await requireUser(request, deps);
    return getProfile(deps, user.id);
  });
}

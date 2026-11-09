import type { FastifyReply } from 'fastify';
import type { Env } from '@madar/shared';

export const REFRESH_COOKIE = 'mf_refresh';
const COOKIE_PATH = '/api/v1/auth';

export function setRefreshCookie(reply: FastifyReply, env: Env, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function clearRefreshCookie(reply: FastifyReply, env: Env): void {
  reply.clearCookie(REFRESH_COOKIE, {
    path: COOKIE_PATH,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
  });
}

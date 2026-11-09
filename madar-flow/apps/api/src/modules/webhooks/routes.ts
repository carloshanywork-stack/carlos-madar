import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { parseParams } from '../../lib/validation.js';
import { handleWebhook } from './service.js';

const MAX_BODY_BYTES = 1024 * 1024;

const webhookParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  path: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, 'Invalid webhook path.'),
});

type RawBodyRequest = FastifyRequest & { rawBody?: string };

export async function webhookRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.addContentTypeParser(
    ['application/json', 'text/plain', 'application/x-www-form-urlencoded'],
    { parseAs: 'string', bodyLimit: MAX_BODY_BYTES },
    (request, body, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      (request as RawBodyRequest).rawBody = raw;
      const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
      if (!raw) {
        done(null, null);
        return;
      }
      try {
        if (contentType.includes('application/x-www-form-urlencoded')) {
          done(null, Object.fromEntries(new URLSearchParams(raw)));
          return;
        }
        if (contentType.includes('application/json')) {
          done(null, JSON.parse(raw));
          return;
        }
        done(null, raw);
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  const handler = async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const params = parseParams(webhookParamsSchema, request.params);
    const rawRequest = request as RawBodyRequest;
    const result = await handleWebhook(deps, {
      workspaceId: params.workspaceId,
      path: params.path,
      method: request.raw.method?.toUpperCase() ?? 'POST',
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, unknown>,
      rawBody: rawRequest.rawBody ?? '',
      parsedBody: request.body ?? null,
    });

    return reply.code(202).send({
      accepted: true,
      ...result,
    });
  };

  const webhookRateLimit = {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  };

  app.post('/:workspaceId/:path', webhookRateLimit, handler);
  app.get('/:workspaceId/:path', webhookRateLimit, handler);
  app.put('/:workspaceId/:path', webhookRateLimit, handler);
}

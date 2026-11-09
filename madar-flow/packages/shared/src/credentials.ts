import { z } from 'zod';

export const CREDENTIAL_TYPES = ['api_key', 'bearer', 'basic', 'oauth2', 'hmac'] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  api_key: 'API Key',
  bearer: 'Bearer Token',
  basic: 'Basic Auth',
  oauth2: 'OAuth2 Client Credentials',
  hmac: 'HMAC Secret (Webhook)',
};

const apiKeySchema = z
  .object({
    secret: z.string().min(1, 'secret مطلوب.').max(4_096),
    headerName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9-]+$/, 'اسم الترويسة غير صالح.')
      .default('x-api-key'),
    valuePrefix: z.string().max(80).optional(),
  })
  .strict();

const bearerSchema = z.object({ token: z.string().min(1, 'token مطلوب.').max(8_192) }).strict();

const basicSchema = z
  .object({
    username: z.string().min(1, 'username مطلوب.').max(512),
    password: z.string().min(1, 'password مطلوب.').max(4_096),
  })
  .strict();

const oauth2Schema = z
  .object({
    clientId: z.string().min(1).max(1_024),
    clientSecret: z.string().min(1).max(4_096),
    tokenUrl: z.string().url('tokenUrl يجب أن يكون رابطًا صالحًا.'),
    scope: z.string().max(1_024).optional(),
    audience: z.string().max(1_024).optional(),
  })
  .strict();

const hmacSchema = z.object({ secret: z.string().min(16, 'secret يجب ألا يقل عن 16 حرفًا.').max(4_096) }).strict();

export const credentialPayloadSchemas: Record<CredentialType, z.ZodTypeAny> = {
  api_key: apiKeySchema,
  bearer: bearerSchema,
  basic: basicSchema,
  oauth2: oauth2Schema,
  hmac: hmacSchema,
};

export interface CredentialValidationIssue {
  path: string;
  message: string;
}

export function validateCredentialPayload(
  type: string,
  payload: unknown,
): CredentialValidationIssue[] {
  const schema = credentialPayloadSchemas[type as CredentialType];
  if (!schema) return [{ path: 'type', message: 'نوع الاعتماد غير مدعوم.' }];
  const result = schema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.') || 'payload',
    message: issue.message,
  }));
}

export function isCredentialType(value: string): value is CredentialType {
  return (CREDENTIAL_TYPES as readonly string[]).includes(value);
}

/** Credential types that can authenticate an HTTP request node. */
export const HTTP_CREDENTIAL_TYPES: CredentialType[] = ['api_key', 'bearer', 'basic', 'oauth2'];

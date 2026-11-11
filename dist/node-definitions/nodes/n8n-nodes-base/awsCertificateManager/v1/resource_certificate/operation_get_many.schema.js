/**
 * AWS Certificate Manager Node - Version 1 - Zod Schema
 * Discriminator: resource=certificate, operation=getMany
 *
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema, resolveSchema, resolveOneOfSchemas }) {

  return z.object({
    parameters: z.object({
      resource: z.literal('certificate').default('certificate'),
      operation: z.literal('getMany'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      options: z.object({ certificateStatuses: z.array(z.union([z.literal('EXPIRED'), z.literal('FAILED'), z.literal('INACTIVE'), z.literal('ISSUED'), z.literal('PENDING_VALIDATION'), z.literal('REVOKED'), z.literal('VALIDATION_TIMED_OUT')])).optional(), extendedKeyUsage: z.array(z.union([z.literal('ANY'), z.literal('CODE_SIGNING'), z.literal('CUSTOM'), z.literal('EMAIL_PROTECTION'), z.literal('IPSEC_END_SYSTEM'), z.literal('IPSEC_TUNNEL'), z.literal('IPSEC_USER'), z.literal('NONE'), z.literal('OCSP_SIGNING'), z.literal('TIME_STAMPING'), z.literal('TLS_WEB_CLIENT_AUTHENTICATION'), z.literal('TLS_WEB_SERVER_AUTHENTICATION')])).optional(), keyTypes: z.array(z.union([z.literal('EC_prime256v1'), z.literal('EC_secp384r1'), z.literal('EC_secp521r1'), z.literal('RSA_1024'), z.literal('RSA_2048'), z.literal('RSA_4096')])).optional(), keyUsage: z.array(z.union([z.literal('ANY'), z.literal('CERTIFICATE_SIGNING'), z.literal('CRL_SIGNING'), z.literal('CUSTOM'), z.literal('DATA_ENCIPHERMENT'), z.literal('DECIPHER_ONLY'), z.literal('DIGITAL_SIGNATURE'), z.literal('ENCIPHER_ONLY'), z.literal('KEY_AGREEMENT'), z.literal('KEY_ENCIPHERMENT'), z.literal('NON_REPUDIATION')])).optional() }).optional(),
    }).optional(),
  });
};
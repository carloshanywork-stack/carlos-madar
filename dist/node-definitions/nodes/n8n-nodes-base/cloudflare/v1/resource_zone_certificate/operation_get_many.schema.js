/**
 * Cloudflare Node - Version 1 - Zod Schema
 * Discriminator: resource=zoneCertificate, operation=getMany
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
      resource: z.literal('zoneCertificate').default('zoneCertificate'),
      operation: z.literal('getMany'),
      zoneId: stringOrExpression,
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      filters: z.object({ status: z.union([z.literal('active'), z.literal('expired'), z.literal('deleted'), z.literal('pending'), expressionSchema]).optional() }).optional(),
    }).optional(),
  });
};
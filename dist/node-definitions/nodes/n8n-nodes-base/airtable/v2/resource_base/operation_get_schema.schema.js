/**
 * Airtable Node - Version 2 - Zod Schema
 * Discriminator: resource=base, operation=getSchema
 *
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema }) {

  return z.object({
    parameters: z.object({
      resource: z.literal('base'),
      operation: z.literal('getSchema'),
      authentication: z.union([z.literal('airtableTokenApi'), z.literal('airtableOAuth2Api'), expressionSchema]).optional(),
      base: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('url'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
    }).optional(),
  });
};
/**
 * Airtable Node - Version 2.1 - Zod Schema
 * Discriminator: resource=record, operation=create
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
      resource: z.literal('record').default('record'),
      operation: z.literal('create'),
      authentication: z.union([z.literal('airtableTokenApi'), z.literal('airtableOAuth2Api'), expressionSchema]).optional(),
      base: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('url'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
      table: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('url'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
      columns: resourceMapperValueSchema.optional(),
      options: z.object({ typecast: booleanOrExpression.optional(), ignoreFields: stringOrExpression.optional(), updateAllMatches: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
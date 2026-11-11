/**
 * Beeminder Node - Version 1 - Zod Schema
 * Discriminator: resource=user, operation=get
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
      resource: z.literal('user'),
      operation: z.literal('get').default('get'),
      authentication: z.union([z.literal('apiToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      additionalFields: z.object({ associations: booleanOrExpression.optional(), diff_since: stringOrExpression.optional(), skinny: booleanOrExpression.optional(), emaciated: booleanOrExpression.optional(), datapoints_count: numberOrExpression.optional() }).optional(),
    }).optional(),
  });
};
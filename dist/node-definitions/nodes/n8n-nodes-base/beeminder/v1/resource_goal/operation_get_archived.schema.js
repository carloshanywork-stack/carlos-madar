/**
 * Beeminder Node - Version 1 - Zod Schema
 * Discriminator: resource=goal, operation=getArchived
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
      resource: z.literal('goal'),
      operation: z.literal('getArchived'),
      authentication: z.union([z.literal('apiToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      additionalFields: z.object({ emaciated: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
/**
 * Asana Node - Version 1 - Zod Schema
 * Discriminator: resource=task, operation=search
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
      resource: z.literal('task').default('task'),
      operation: z.literal('search'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      workspace: stringOrExpression,
      searchTaskProperties: z.object({ completed: booleanOrExpression.optional(), text: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
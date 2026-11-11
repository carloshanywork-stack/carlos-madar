/**
 * Asana Node - Version 1 - Zod Schema
 * Discriminator: resource=taskProject, operation=add
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
      resource: z.literal('taskProject'),
      operation: z.literal('add').default('add'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      id: stringOrExpression,
      project: stringOrExpression,
      additionalFields: z.object({ insert_after: stringOrExpression.optional(), insert_before: stringOrExpression.optional(), section: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
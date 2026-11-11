/**
 * ClickUp Node - Version 1 - Zod Schema
 * Discriminator: resource=goal, operation=create
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
      operation: z.literal('create').default('create'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      team: stringOrExpression,
      name: stringOrExpression,
      additionalFields: z.object({ color: stringOrExpression.optional(), description: stringOrExpression.optional(), dueDate: stringOrExpression.optional(), multipleOwners: booleanOrExpression.optional(), owners: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
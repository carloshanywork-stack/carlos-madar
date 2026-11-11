/**
 * Asana Node - Version 1 - Zod Schema
 * Discriminator: resource=subtask, operation=create
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
      resource: z.literal('subtask'),
      operation: z.literal('create').default('create'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      taskId: stringOrExpression,
      name: stringOrExpression,
      otherProperties: z.object({ assignee: stringOrExpression.optional(), assignee_status: z.union([z.literal('inbox'), z.literal('today'), z.literal('upcoming'), z.literal('later'), expressionSchema]).optional(), completed: booleanOrExpression.optional(), due_on: stringOrExpression.optional(), liked: booleanOrExpression.optional(), notes: stringOrExpression.optional(), workspace: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
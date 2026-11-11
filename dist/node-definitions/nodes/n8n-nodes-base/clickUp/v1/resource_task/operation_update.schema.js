/**
 * ClickUp Node - Version 1 - Zod Schema
 * Discriminator: resource=task, operation=update
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
      operation: z.literal('update'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      id: stringOrExpression,
      updateFields: z.object({ addAssignees: stringOrExpression.optional(), content: stringOrExpression.optional(), dueDate: stringOrExpression.optional(), dueDateTime: booleanOrExpression.optional(), markdownContent: booleanOrExpression.optional(), name: stringOrExpression.optional(), notifyAll: booleanOrExpression.optional(), parentId: stringOrExpression.optional(), priority: numberOrExpression.optional(), removeAssignees: stringOrExpression.optional(), status: stringOrExpression.optional(), startDate: stringOrExpression.optional(), startDateTime: booleanOrExpression.optional(), timeEstimate: numberOrExpression.optional() }).optional(),
    }).optional(),
  });
};
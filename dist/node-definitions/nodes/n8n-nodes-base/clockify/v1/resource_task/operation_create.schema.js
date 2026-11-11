/**
 * Clockify Node - Version 1 - Zod Schema
 * Discriminator: resource=task, operation=create
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
      resource: z.literal('task'),
      operation: z.literal('create').default('create'),
      workspaceId: stringOrExpression.optional(),
      projectId: stringOrExpression,
      name: stringOrExpression,
      additionalFields: z.object({ assigneeIds: z.array(z.string()).optional(), estimate: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
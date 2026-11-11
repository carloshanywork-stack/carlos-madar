/**
 * Clockify Node - Version 1 - Zod Schema
 * Discriminator: resource=timeEntry, operation=create
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
      resource: z.literal('timeEntry'),
      operation: z.literal('create').default('create'),
      workspaceId: stringOrExpression.optional(),
      start: stringOrExpression,
      additionalFields: z.object({ billable: booleanOrExpression.optional(), customFieldsUi: z.object({ customFieldsValues: z.array(z.object({ customFieldId: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional(), description: stringOrExpression.optional(), end: stringOrExpression.optional(), projectId: stringOrExpression.optional(), tagIds: z.array(z.string()).optional(), taskId: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
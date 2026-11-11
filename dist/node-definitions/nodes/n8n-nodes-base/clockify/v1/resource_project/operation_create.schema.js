/**
 * Clockify Node - Version 1 - Zod Schema
 * Discriminator: resource=project, operation=create
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
      resource: z.literal('project').default('project'),
      operation: z.literal('create').default('create'),
      workspaceId: stringOrExpression.optional(),
      name: stringOrExpression,
      additionalFields: z.object({ billable: booleanOrExpression.optional(), color: stringOrExpression.optional(), clientId: stringOrExpression.optional(), estimateUi: z.object({ estimateValues: z.object({ estimate: numberOrExpression.optional(), type: z.union([z.literal('AUTO'), z.literal('MANUAL'), expressionSchema]).optional() }).optional() }).optional(), isPublic: booleanOrExpression.optional(), note: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
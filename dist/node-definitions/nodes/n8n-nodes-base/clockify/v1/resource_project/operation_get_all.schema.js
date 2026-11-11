/**
 * Clockify Node - Version 1 - Zod Schema
 * Discriminator: resource=project, operation=getAll
 *
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema, resolveSchema, resolveOneOfSchemas }) {

  return z.object({
    parameters: z.object({
      resource: z.literal('project').default('project'),
      operation: z.literal('getAll'),
      workspaceId: stringOrExpression.optional(),
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      additionalFields: z.object({ archived: booleanOrExpression.optional(), billable: booleanOrExpression.optional(), clients: z.array(z.string()).optional(), 'contains-client': booleanOrExpression.optional(), 'client-status': z.union([z.literal('ACTIVE'), z.literal('ARCHIVED'), expressionSchema]).optional(), 'contains-user': booleanOrExpression.optional(), 'is-template': booleanOrExpression.optional(), name: stringOrExpression.optional(), 'sort-column': z.union([z.literal('NAME'), z.literal('CLIENT_NAME'), z.literal('DURATION'), expressionSchema]).optional(), 'sort-order': z.union([z.literal('ASCENDING'), z.literal('DESCENDING'), expressionSchema]).optional(), users: stringOrExpression.optional(), 'user-status': z.union([z.literal('ACTIVE'), z.literal('ARCHIVED'), expressionSchema]).optional() }).optional(),
    }).optional(),
  });
};
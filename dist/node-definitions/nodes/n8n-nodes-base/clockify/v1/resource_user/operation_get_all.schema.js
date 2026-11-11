/**
 * Clockify Node - Version 1 - Zod Schema
 * Discriminator: resource=user, operation=getAll
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
      resource: z.literal('user'),
      operation: z.literal('getAll').default('getAll'),
      workspaceId: stringOrExpression.optional(),
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      additionalFields: z.object({ email: stringOrExpression.optional(), name: stringOrExpression.optional(), status: z.union([z.literal('ACTIVE'), z.literal('INACTIVE'), z.literal('PENDING'), z.literal('DECLINED'), expressionSchema]).optional(), 'sort-column': z.union([z.literal('EMAIL'), z.literal('NAME'), z.literal('HOURLYRATE'), expressionSchema]).optional(), 'sort-order': z.union([z.literal('ASCENDING'), z.literal('DESCENDING'), expressionSchema]).optional() }).optional(),
    }).optional(),
  });
};
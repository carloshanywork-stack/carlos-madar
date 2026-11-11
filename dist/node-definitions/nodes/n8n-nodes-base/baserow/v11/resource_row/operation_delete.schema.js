/**
 * Baserow Node - Version 1.1 - Zod Schema
 * Discriminator: resource=row, operation=delete
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
      resource: z.literal('row').default('row'),
      operation: z.literal('delete'),
      authentication: z.union([z.literal('usernamePassword'), z.literal('databaseToken'), expressionSchema]).optional(),
      databaseId: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"hide":{"authentication":["databaseToken"]}}, defaults: {"authentication":"usernamePassword"} }),
      tableId: stringOrExpression,
      rowId: stringOrExpression,
    }).optional(),
  });
};
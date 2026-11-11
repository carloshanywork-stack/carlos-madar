/**
 * Coda Node - Version 1.1 - Zod Schema
 * Discriminator: resource=table, operation=getAllRows
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
      resource: z.literal('table').default('table'),
      operation: z.literal('getAllRows'),
      docId: stringOrExpression,
      tableId: stringOrExpression,
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      options: z.object({ query: stringOrExpression.optional(), rawData: booleanOrExpression.optional(), sortBy: z.union([z.literal('createdAt'), z.literal('natural'), expressionSchema]).optional(), useColumnNames: booleanOrExpression.optional(), valueFormat: z.union([z.literal('simple'), z.literal('simpleWithArrays'), z.literal('rich'), expressionSchema]).optional(), visibleOnly: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
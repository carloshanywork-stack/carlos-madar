/**
 * Coda Node - Version 1.1 - Zod Schema
 * Discriminator: resource=table, operation=pushButton
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
      resource: z.literal('table').default('table'),
      operation: z.literal('pushButton'),
      docId: stringOrExpression,
      tableId: stringOrExpression,
      rowId: stringOrExpression,
      columnId: stringOrExpression,
    }).optional(),
  });
};
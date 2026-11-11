/**
 * Coda Node - Version 1 - Zod Schema
 * Discriminator: resource=view, operation=updateViewRow
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
      resource: z.literal('view'),
      operation: z.literal('updateViewRow'),
      docId: stringOrExpression,
      viewId: stringOrExpression,
      rowId: stringOrExpression,
      keyName: stringOrExpression.optional(),
      options: z.object({ disableParsing: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
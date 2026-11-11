/**
 * Airtop Node - Version 1.1 - Zod Schema
 * Discriminator: resource=window, operation=close
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
      resource: z.literal('window'),
      operation: z.literal('close'),
      sessionId: stringOrExpression.optional(),
      windowId: stringOrExpression.optional(),
    }).optional(),
  });
};
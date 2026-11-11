/**
 * Airtop Node - Version 1 - Zod Schema
 * Discriminator: resource=window, operation=load
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
      operation: z.literal('load'),
      sessionId: stringOrExpression.optional(),
      windowId: stringOrExpression.optional(),
      url: stringOrExpression,
      additionalFields: z.object({ waitUntil: z.union([z.literal('complete'), z.literal('domContentLoaded'), z.literal('load'), z.literal('noWait'), expressionSchema]).optional() }).optional(),
    }).optional(),
  });
};
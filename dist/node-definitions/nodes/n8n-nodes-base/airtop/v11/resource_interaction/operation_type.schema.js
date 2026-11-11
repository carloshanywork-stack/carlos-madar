/**
 * Airtop Node - Version 1.1 - Zod Schema
 * Discriminator: resource=interaction, operation=type
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
      resource: z.literal('interaction'),
      operation: z.literal('type'),
      sessionId: stringOrExpression.optional(),
      windowId: stringOrExpression.optional(),
      text: stringOrExpression,
      pressEnterKey: booleanOrExpression.optional(),
      elementDescription: stringOrExpression.optional(),
      additionalFields: z.object({ visualScope: z.union([z.literal('auto'), z.literal('viewport'), z.literal('page'), z.literal('scan'), expressionSchema]).optional(), waitForNavigation: z.union([z.literal('load'), z.literal('domcontentloaded'), z.literal('networkidle0'), z.literal('networkidle2'), expressionSchema]).optional() }).optional(),
    }).optional(),
  });
};
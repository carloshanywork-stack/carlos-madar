/**
 * Airtop Node - Version 1 - Zod Schema
 * Discriminator: resource=interaction, operation=scroll
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
      resource: z.literal('interaction'),
      operation: z.literal('scroll'),
      sessionId: stringOrExpression.optional(),
      windowId: stringOrExpression.optional(),
      scrollingMode: z.union([z.literal('automatic'), z.literal('manual'), expressionSchema]).optional(),
      scrollToElement: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"scrollingMode":["automatic"]}}, defaults: {"scrollingMode":"automatic"} }),
      scrollToEdge: resolveSchema({ parameters, schema: z.object({ edgeValues: z.object({ yAxis: z.union([z.literal(''), z.literal('top'), z.literal('bottom'), expressionSchema]).optional(), xAxis: z.union([z.literal(''), z.literal('left'), z.literal('right'), expressionSchema]).optional() }).optional() }), required: false, displayOptions: {"show":{"scrollingMode":["manual"]}}, defaults: {"scrollingMode":"automatic"} }),
      scrollBy: resolveSchema({ parameters, schema: z.object({ scrollValues: z.object({ yAxis: stringOrExpression.optional(), xAxis: stringOrExpression.optional() }).optional() }), required: false, displayOptions: {"show":{"scrollingMode":["manual"]}}, defaults: {"scrollingMode":"automatic"} }),
      scrollWithin: stringOrExpression.optional(),
      additionalFields: z.object({ visualScope: z.union([z.literal('auto'), z.literal('viewport'), z.literal('page'), z.literal('scan'), expressionSchema]).optional(), waitForNavigation: z.union([z.literal('load'), z.literal('domcontentloaded'), z.literal('networkidle0'), z.literal('networkidle2'), expressionSchema]).optional() }).optional(),
    }).optional(),
  });
};
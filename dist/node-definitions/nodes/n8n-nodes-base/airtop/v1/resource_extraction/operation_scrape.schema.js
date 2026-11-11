/**
 * Airtop Node - Version 1 - Zod Schema
 * Discriminator: resource=extraction, operation=scrape
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
      resource: z.literal('extraction'),
      operation: z.literal('scrape'),
      sessionMode: z.union([z.literal('new'), z.literal('existing'), expressionSchema]).optional(),
      sessionId: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"sessionMode":["existing"]}}, defaults: {"sessionMode":"existing"} }),
      windowId: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"sessionMode":["existing"]}}, defaults: {"sessionMode":"existing"} }),
      url: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"sessionMode":["new"]}}, defaults: {"sessionMode":"existing"} }),
      profileName: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"sessionMode":["new"]}}, defaults: {"sessionMode":"existing"} }),
      autoTerminateSession: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"sessionMode":["new"]}}, defaults: {"sessionMode":"existing"} }),
    }).optional(),
  });
};
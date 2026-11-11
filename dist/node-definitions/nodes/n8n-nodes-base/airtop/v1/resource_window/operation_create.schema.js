/**
 * Airtop Node - Version 1 - Zod Schema
 * Discriminator: resource=window, operation=create
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
      resource: z.literal('window'),
      operation: z.literal('create').default('create'),
      sessionId: stringOrExpression.optional(),
      url: stringOrExpression.optional(),
      getLiveView: booleanOrExpression.optional(),
      includeNavigationBar: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"getLiveView":[true]}}, defaults: {"getLiveView":false} }),
      screenResolution: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"getLiveView":[true]}}, defaults: {"getLiveView":false} }),
      disableResize: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"getLiveView":[true]}}, defaults: {"getLiveView":false} }),
      additionalFields: z.object({ waitUntil: z.union([z.literal('load'), z.literal('domContentLoaded'), z.literal('complete'), z.literal('noWait'), expressionSchema]).optional() }).optional(),
    }).optional(),
  });
};
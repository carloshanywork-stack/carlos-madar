/**
 * Airtop Node - Version 1 - Zod Schema
 * Discriminator: resource=file, operation=upload
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
      resource: z.literal('file'),
      operation: z.literal('upload'),
      sessionId: stringOrExpression.optional(),
      windowId: stringOrExpression.optional(),
      fileName: stringOrExpression,
      fileType: z.union([z.literal('browser_download'), z.literal('screenshot'), z.literal('video'), z.literal('customer_upload'), expressionSchema]).optional(),
      source: z.union([z.literal('url'), z.literal('binary'), expressionSchema]).optional(),
      binaryPropertyName: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"source":["binary"]}}, defaults: {"source":"url"} }),
      url: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"source":["url"]}}, defaults: {"source":"url"} }),
      triggerFileInputParameter: booleanOrExpression.optional(),
      elementDescription: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"triggerFileInputParameter":[true]}}, defaults: {"triggerFileInputParameter":true} }),
      includeHiddenElements: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"triggerFileInputParameter":[true]}}, defaults: {"triggerFileInputParameter":true} }),
    }).optional(),
  });
};
/**
 * Azure Cosmos DB Node - Version 1 - Zod Schema
 * Discriminator: resource=item, operation=delete
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
      resource: z.literal('item'),
      operation: z.literal('delete'),
      container: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
      item: resolveSchema({ parameters, schema: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]), required: false, displayOptions: {"hide":{"container":[""]}}, defaults: {"container":{"mode":"list","value":""}} }),
      additionalFields: resolveSchema({ parameters, schema: z.object({ partitionKey: stringOrExpression.optional() }), required: false, displayOptions: {"hide":{"container":[""],"item":[""]}}, defaults: {"container":{"mode":"list","value":""},"item":{"mode":"list","value":""}} }),
      requestOptions: z.object({ batching: z.object({ batch: z.object({ batchSize: numberOrExpression.optional(), batchInterval: numberOrExpression.optional() }).optional() }).optional(), allowUnauthorizedCerts: z.boolean().optional(), proxy: stringOrExpression.optional(), timeout: numberOrExpression.optional() }).optional(),
    }).optional(),
  });
};
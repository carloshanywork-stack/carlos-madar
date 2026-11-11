/**
 * Azure Storage Node - Version 1 - Zod Schema
 * Discriminator: resource=blob, operation=create
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
      resource: z.literal('blob'),
      operation: z.literal('create'),
      authentication: z.union([z.literal('oAuth2'), z.literal('sharedKey'), expressionSchema]).optional(),
      container: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
      blobCreate: stringOrExpression,
      from: z.union([z.literal('binary'), z.literal('url'), expressionSchema]).optional(),
      binaryPropertyName: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"from":["binary"]}}, defaults: {"from":"binary"} }),
      url: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"from":["url"]}}, defaults: {"from":"binary"} }),
      options: z.object({ accessTier: z.union([z.literal('Archive'), z.literal('Cold'), z.literal('Cool'), z.literal('Hot'), expressionSchema]).optional(), blobType: z.union([z.literal('BlockBlob'), z.literal('PageBlob'), z.literal('AppendBlob'), expressionSchema]).optional(), cacheControl: stringOrExpression.optional(), contentCrc64: stringOrExpression.optional(), contentEncoding: stringOrExpression.optional(), contentLanguage: stringOrExpression.optional(), contentMd5: stringOrExpression.optional(), contentType: stringOrExpression.optional(), encryptionContext: stringOrExpression.optional(), encryptionScope: stringOrExpression.optional(), expiryOption: z.union([z.literal('Absolute'), z.literal('NeverExpire'), expressionSchema]).optional(), expiryTime: stringOrExpression.optional(), filename: stringOrExpression.optional(), immutabilityPolicyUntilDate: stringOrExpression.optional(), immutabilityPolicyMode: stringOrExpression.optional(), leaseId: stringOrExpression.optional(), legalHold: booleanOrExpression.optional(), metadata: z.object({ metadataValues: z.array(z.object({ fieldName: stringOrExpression.optional(), fieldValue: stringOrExpression.optional() })).optional() }).optional(), origin: stringOrExpression.optional(), tags: z.object({ tagValues: z.array(z.object({ tagName: stringOrExpression.optional(), tagValue: stringOrExpression.optional() })).optional() }).optional() }).optional(),
      requestOptions: z.object({ batching: z.object({ batch: z.object({ batchSize: numberOrExpression.optional(), batchInterval: numberOrExpression.optional() }).optional() }).optional(), allowUnauthorizedCerts: z.boolean().optional(), proxy: stringOrExpression.optional(), timeout: numberOrExpression.optional() }).optional(),
    }).optional(),
  });
};
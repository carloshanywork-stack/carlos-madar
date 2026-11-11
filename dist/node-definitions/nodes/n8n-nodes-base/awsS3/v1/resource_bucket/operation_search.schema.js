/**
 * AWS S3 Node - Version 1 - Zod Schema
 * Discriminator: resource=bucket, operation=search
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
      resource: z.literal('bucket'),
      operation: z.literal('search'),
      bucketName: stringOrExpression,
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      additionalFields: z.object({ delimiter: stringOrExpression.optional(), encodingType: z.union([z.literal('url'), expressionSchema]).optional(), fetchOwner: booleanOrExpression.optional(), prefix: stringOrExpression.optional(), requesterPays: booleanOrExpression.optional(), startAfter: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
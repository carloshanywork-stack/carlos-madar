/**
 * AWS S3 Node - Version 2 - Zod Schema
 * Discriminator: resource=folder, operation=getAll
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
      resource: z.literal('folder'),
      operation: z.literal('getAll'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      bucketName: stringOrExpression,
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      options: z.object({ fetchOwner: booleanOrExpression.optional(), folderKey: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
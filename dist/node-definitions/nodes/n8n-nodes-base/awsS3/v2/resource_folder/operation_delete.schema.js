/**
 * AWS S3 Node - Version 2 - Zod Schema
 * Discriminator: resource=folder, operation=delete
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
      resource: z.literal('folder'),
      operation: z.literal('delete'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      bucketName: stringOrExpression,
      folderKey: stringOrExpression,
    }).optional(),
  });
};
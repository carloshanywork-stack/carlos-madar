/**
 * AWS S3 Node - Version 1 - Zod Schema
 * Discriminator: resource=folder, operation=create
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
      operation: z.literal('create').default('create'),
      bucketName: stringOrExpression,
      folderName: stringOrExpression,
      additionalFields: z.object({ parentFolderKey: stringOrExpression.optional(), requesterPays: booleanOrExpression.optional(), storageClass: z.union([z.literal('deepArchive'), z.literal('glacier'), z.literal('intelligentTiering'), z.literal('onezoneIA'), z.literal('RecudedRedundancy'), z.literal('standard'), z.literal('standardIA'), expressionSchema]).optional() }).optional(),
    }).optional(),
  });
};
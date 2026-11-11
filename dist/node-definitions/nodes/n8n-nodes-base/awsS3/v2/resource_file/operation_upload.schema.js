/**
 * AWS S3 Node - Version 2 - Zod Schema
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
      resource: z.literal('file').default('file'),
      operation: z.literal('upload'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      bucketName: stringOrExpression,
      fileName: resolveOneOfSchemas({ parameters, variants: [{ schema: stringOrExpression, required: true, displayOptions: {"show":{"binaryData":[false]}}, defaults: {"binaryData":true} }, { schema: stringOrExpression, required: false, displayOptions: {"show":{"binaryData":[true]}}, defaults: {"binaryData":true} }] }),
      binaryData: booleanOrExpression.optional(),
      fileContent: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"binaryData":[false]}}, defaults: {"binaryData":true} }),
      binaryPropertyName: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"binaryData":[true]}}, defaults: {"binaryData":true} }),
      additionalFields: z.object({ acl: z.union([z.literal('authenticatedRead'), z.literal('awsExecRead'), z.literal('bucketOwnerFullControl'), z.literal('bucketOwnerRead'), z.literal('private'), z.literal('publicRead'), z.literal('publicReadWrite'), expressionSchema]).optional(), grantFullControl: booleanOrExpression.optional(), grantRead: booleanOrExpression.optional(), grantReadAcp: booleanOrExpression.optional(), grantWriteAcp: booleanOrExpression.optional(), lockLegalHold: booleanOrExpression.optional(), lockMode: z.union([z.literal('governance'), z.literal('compliance'), expressionSchema]).optional(), lockRetainUntilDate: stringOrExpression.optional(), parentFolderKey: stringOrExpression.optional(), requesterPays: booleanOrExpression.optional(), serverSideEncryption: z.union([z.literal('AES256'), z.literal('aws:kms'), expressionSchema]).optional(), serverSideEncryptionContext: stringOrExpression.optional(), encryptionAwsKmsKeyId: stringOrExpression.optional(), serversideEncryptionCustomerAlgorithm: stringOrExpression.optional(), serversideEncryptionCustomerKey: stringOrExpression.optional(), serversideEncryptionCustomerKeyMD5: stringOrExpression.optional(), storageClass: z.union([z.literal('deepArchive'), z.literal('glacier'), z.literal('intelligentTiering'), z.literal('onezoneIA'), z.literal('standard'), z.literal('standardIA'), expressionSchema]).optional() }).optional(),
      tagsUi: z.object({ tagsValues: z.array(z.object({ key: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional(),
    }).optional(),
  });
};
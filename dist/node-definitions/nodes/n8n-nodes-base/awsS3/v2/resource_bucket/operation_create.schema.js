/**
 * AWS S3 Node - Version 2 - Zod Schema
 * Discriminator: resource=bucket, operation=create
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
      resource: z.literal('bucket'),
      operation: z.literal('create').default('create'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      name: stringOrExpression,
      additionalFields: z.object({ acl: z.union([z.literal('authenticatedRead'), z.literal('Private'), z.literal('publicRead'), z.literal('publicReadWrite'), expressionSchema]).optional(), bucketObjectLockEnabled: booleanOrExpression.optional(), grantFullControl: booleanOrExpression.optional(), grantRead: booleanOrExpression.optional(), grantReadAcp: booleanOrExpression.optional(), grantWrite: booleanOrExpression.optional(), grantWriteAcp: booleanOrExpression.optional(), region: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
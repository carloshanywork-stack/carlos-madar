/**
 * AWS Cognito Node - Version 1 - Zod Schema
 * Discriminator: resource=user, operation=update
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
      resource: z.literal('user').default('user'),
      operation: z.literal('update'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      userPool: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
      user: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
      userAttributes: z.object({ attributes: z.array(z.object({ attributeType: z.union([z.literal('standard'), z.literal('custom'), expressionSchema]).optional(), standardName: z.union([z.literal('address'), z.literal('birthdate'), z.literal('email'), z.literal('family_name'), z.literal('gender'), z.literal('given_name'), z.literal('locale'), z.literal('middle_name'), z.literal('name'), z.literal('nickname'), z.literal('phone_number'), z.literal('preferred_username'), z.literal('profilepicture'), z.literal('updated_at'), z.literal('sub'), z.literal('website'), z.literal('zoneinfo'), expressionSchema]).optional(), customName: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional(),
      requestOptions: z.object({ batching: z.object({ batch: z.object({ batchSize: numberOrExpression.optional(), batchInterval: numberOrExpression.optional() }).optional() }).optional(), allowUnauthorizedCerts: z.boolean().optional(), proxy: stringOrExpression.optional(), timeout: numberOrExpression.optional() }).optional(),
    }).optional(),
  });
};
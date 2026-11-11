/**
 * AWS Cognito Node - Version 1 - Zod Schema
 * Discriminator: resource=group, operation=update
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
      resource: z.literal('group'),
      operation: z.literal('update'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      userPool: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
      group: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('groupName')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
      additionalFields: z.object({ description: stringOrExpression.optional(), precedence: numberOrExpression.optional(), arn: stringOrExpression.optional() }).optional(),
      requestOptions: z.object({ batching: z.object({ batch: z.object({ batchSize: numberOrExpression.optional(), batchInterval: numberOrExpression.optional() }).optional() }).optional(), allowUnauthorizedCerts: z.boolean().optional(), proxy: stringOrExpression.optional(), timeout: numberOrExpression.optional() }).optional(),
    }).optional(),
  });
};
/**
 * Azure Cosmos DB Node - Version 1 - Zod Schema
 * Discriminator: resource=container, operation=create
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
      resource: z.literal('container').default('container'),
      operation: z.literal('create'),
      containerCreate: stringOrExpression,
      partitionKey: z.union([iDataObjectSchema, z.string()]).optional(),
      additionalFields: z.object({ indexingPolicy: z.union([iDataObjectSchema, z.string()]).optional(), maxThroughput: numberOrExpression.optional(), offerThroughput: numberOrExpression.optional() }).optional(),
      requestOptions: z.object({ batching: z.object({ batch: z.object({ batchSize: numberOrExpression.optional(), batchInterval: numberOrExpression.optional() }).optional() }).optional(), allowUnauthorizedCerts: z.boolean().optional(), proxy: stringOrExpression.optional(), timeout: numberOrExpression.optional() }).optional(),
    }).optional(),
  });
};
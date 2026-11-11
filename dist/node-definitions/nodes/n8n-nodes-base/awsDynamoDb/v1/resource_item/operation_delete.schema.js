/**
 * AWS DynamoDB Node - Version 1 - Zod Schema
 * Discriminator: resource=item, operation=delete
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
      resource: z.literal('item').default('item'),
      operation: z.literal('delete'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      tableName: stringOrExpression.optional(),
      returnValues: z.union([z.literal('ALL_OLD'), z.literal('NONE'), expressionSchema]).optional(),
      keysUi: z.object({ keyValues: z.array(z.object({ key: stringOrExpression.optional(), type: z.union([z.literal('B'), z.literal('N'), z.literal('S'), expressionSchema]).optional(), value: stringOrExpression.optional() })).optional() }).optional(),
      simple: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"returnValues":["ALL_OLD"]}}, defaults: {"returnValues":"NONE"} }),
      additionalFields: z.object({ conditionExpression: stringOrExpression.optional(), eanUi: z.object({ eanValues: z.array(z.object({ key: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional(), expressionAttributeUi: z.object({ expressionAttributeValues: z.array(z.object({ attribute: stringOrExpression.optional(), type: z.union([z.literal('N'), z.literal('S'), expressionSchema]).optional(), value: stringOrExpression.optional() })).optional() }).optional() }).optional(),
      filterExpression: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"scan":[true]}} }),
    }).optional(),
  });
};
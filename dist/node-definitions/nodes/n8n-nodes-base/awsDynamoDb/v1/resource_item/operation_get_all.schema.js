/**
 * AWS DynamoDB Node - Version 1 - Zod Schema
 * Discriminator: resource=item, operation=getAll
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
      operation: z.literal('getAll'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      tableName: stringOrExpression.optional(),
      scan: booleanOrExpression.optional(),
      filterExpression: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"scan":[true]}}, defaults: {"scan":false} }),
      keyConditionExpression: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"scan":[false]}}, defaults: {"scan":false} }),
      eavUi: z.object({ eavValues: z.array(z.object({ attribute: stringOrExpression.optional(), type: z.union([z.literal('N'), z.literal('S'), expressionSchema]).optional(), value: stringOrExpression.optional() })).optional() }).optional(),
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      select: z.union([z.literal('ALL_ATTRIBUTES'), z.literal('ALL_PROJECTED_ATTRIBUTES'), z.literal('COUNT'), z.literal('SPECIFIC_ATTRIBUTES'), expressionSchema]).optional(),
      simple: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"select":["ALL_PROJECTED_ATTRIBUTES","ALL_ATTRIBUTES","SPECIFIC_ATTRIBUTES"]}}, defaults: {"select":"ALL_ATTRIBUTES"} }),
      options: z.object({ indexName: stringOrExpression.optional(), projectionExpression: stringOrExpression.optional(), filterExpression: stringOrExpression.optional(), eanUi: z.object({ eanValues: z.array(z.object({ key: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional() }).optional(),
    }).optional(),
  });
};
/**
 * Agile CRM Node - Version 1 - Zod Schema
 * Discriminator: resource=contact, operation=getAll
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
      resource: z.literal('contact').default('contact'),
      operation: z.literal('getAll'),
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      filterType: z.union([z.literal('none'), z.literal('manual'), z.literal('json'), expressionSchema]).optional(),
      matchType: resolveSchema({ parameters, schema: z.union([z.literal('anyFilter'), z.literal('allFilters'), expressionSchema]), required: false, displayOptions: {"show":{"filterType":["manual"]}}, defaults: {"filterType":"none"} }),
      simple: booleanOrExpression.optional(),
      filters: resolveSchema({ parameters, schema: z.object({ conditions: z.array(z.object({ field: stringOrExpression.optional(), condition_type: z.union([z.literal('AFTER'), z.literal('BEFORE'), z.literal('BETWEEN'), z.literal('EQUALS'), z.literal('LAST'), z.literal('NOTEQUALS'), z.literal('ON'), expressionSchema]).optional(), value: stringOrExpression.optional(), value2: stringOrExpression.optional() })).optional() }), required: false, displayOptions: {"show":{"filterType":["manual"]}}, defaults: {"filterType":"none"} }),
      filterJson: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"filterType":["json"]}}, defaults: {"filterType":"none"} }),
      options: z.object({ sort: z.object({ sort: z.object({ direction: z.union([z.literal('ASC'), z.literal('DESC'), expressionSchema]).optional(), field: stringOrExpression.optional() }).optional() }).optional() }).optional(),
    }).optional(),
  });
};
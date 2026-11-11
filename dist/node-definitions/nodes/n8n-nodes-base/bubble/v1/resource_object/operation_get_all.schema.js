/**
 * Bubble Node - Version 1 - Zod Schema
 * Discriminator: resource=object, operation=getAll
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
      resource: z.literal('object').default('object'),
      operation: z.literal('getAll'),
      typeName: stringOrExpression,
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      jsonParameters: booleanOrExpression.optional(),
      options: z.object({ filters: z.object({ filter: z.array(z.object({ key: stringOrExpression.optional(), constraint_type: z.union([z.literal('equals'), z.literal('not equal'), z.literal('is_empty'), z.literal('is_not_empty'), z.literal('text contains'), z.literal('not text contains'), z.literal('greater than'), z.literal('less than'), z.literal('in'), z.literal('not in'), z.literal('contains'), z.literal('not contains'), z.literal('empty'), z.literal('not empty'), z.literal('geographic_search'), expressionSchema]).optional(), value: stringOrExpression.optional() })).optional() }).optional(), filtersJson: z.union([iDataObjectSchema, z.string()]).optional(), sort: z.object({ sortValue: z.object({ sort_field: stringOrExpression.optional(), descending: booleanOrExpression.optional(), geo_reference: stringOrExpression.optional() }).optional() }).optional() }).optional(),
    }).optional(),
  });
};
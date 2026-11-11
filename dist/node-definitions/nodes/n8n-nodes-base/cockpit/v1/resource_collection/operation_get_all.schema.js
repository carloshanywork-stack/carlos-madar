/**
 * Cockpit Node - Version 1 - Zod Schema
 * Discriminator: resource=collection, operation=getAll
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
      resource: z.literal('collection').default('collection'),
      operation: z.literal('getAll').default('getAll'),
      collection: stringOrExpression,
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      options: z.object({ fields: stringOrExpression.optional(), filter: z.union([iDataObjectSchema, z.string()]).optional(), language: stringOrExpression.optional(), populate: booleanOrExpression.optional(), rawData: booleanOrExpression.optional(), skip: numberOrExpression.optional(), sort: z.union([iDataObjectSchema, z.string()]).optional() }).optional(),
    }).optional(),
  });
};
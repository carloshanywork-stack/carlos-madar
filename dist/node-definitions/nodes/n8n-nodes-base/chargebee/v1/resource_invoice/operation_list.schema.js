/**
 * Chargebee Node - Version 1 - Zod Schema
 * Discriminator: resource=invoice, operation=list
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
      resource: z.literal('invoice').default('invoice'),
      operation: z.literal('list').default('list'),
      maxResults: numberOrExpression.optional(),
      filters: z.object({ date: z.array(z.object({ operation: z.union([z.literal('is'), z.literal('is_not'), z.literal('after'), z.literal('before')]).optional(), value: stringOrExpression.optional() })).optional(), total: z.array(z.object({ operation: z.union([z.literal('gte'), z.literal('gt'), z.literal('is'), z.literal('is_not'), z.literal('lte'), z.literal('lt')]).optional(), value: numberOrExpression.optional() })).optional() }).optional(),
    }).optional(),
  });
};
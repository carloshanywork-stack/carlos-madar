/**
 * ActiveCampaign Node - Version 1 - Zod Schema
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
      simple: booleanOrExpression.optional(),
      additionalFields: z.object({ datetime: stringOrExpression.optional(), email: stringOrExpression.optional(), email_like: stringOrExpression.optional(), exclude: stringOrExpression.optional(), formid: stringOrExpression.optional(), listid: stringOrExpression.optional(), search: stringOrExpression.optional(), segmentid: stringOrExpression.optional(), seriesid: stringOrExpression.optional(), status: z.union([z.literal(1), z.literal(-1), z.literal(3), z.literal(0), z.literal(2), expressionSchema]).optional(), tagid: stringOrExpression.optional(), 'filters[created_before]': stringOrExpression.optional(), 'filters[created_after]': stringOrExpression.optional(), 'filters[updated_before]': stringOrExpression.optional(), 'filters[updated_after]': stringOrExpression.optional(), waitid: stringOrExpression.optional(), orderBy: z.union([z.literal('orders[cdate]'), z.literal('orders[email]'), z.literal('orders[first_name]'), z.literal('orders[last_name]'), z.literal('orders[name]'), z.literal('orders[score]'), expressionSchema]).optional() }).optional(),
    }).optional(),
  });
};
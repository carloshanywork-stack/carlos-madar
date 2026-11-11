/**
 * Chargebee Node - Version 1 - Zod Schema
 * Discriminator: resource=customer, operation=create
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
      resource: z.literal('customer'),
      operation: z.literal('create').default('create'),
      properties: z.object({ id: stringOrExpression.optional(), first_name: stringOrExpression.optional(), last_name: stringOrExpression.optional(), email: stringOrExpression.optional(), phone: stringOrExpression.optional(), company: stringOrExpression.optional(), customProperties: z.object({ property: z.array(z.object({ name: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional() }).optional(),
    }).optional(),
  });
};
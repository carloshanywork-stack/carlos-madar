/**
 * ActiveCampaign Node - Version 1 - Zod Schema
 * Discriminator: resource=contact, operation=update
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
      resource: z.literal('contact').default('contact'),
      operation: z.literal('update'),
      contactId: numberOrExpression.optional(),
      updateFields: z.object({ fieldValues: z.object({ property: z.array(z.object({ field: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional(), email: stringOrExpression.optional(), firstName: stringOrExpression.optional(), lastName: stringOrExpression.optional(), phone: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
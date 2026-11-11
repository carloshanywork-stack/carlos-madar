/**
 * Action Network Node - Version 1 - Zod Schema
 * Discriminator: resource=event, operation=create
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
      resource: z.literal('event'),
      operation: z.literal('create').default('create'),
      originSystem: stringOrExpression,
      title: stringOrExpression,
      simple: booleanOrExpression.optional(),
      additionalFields: z.object({ browser_url: stringOrExpression.optional(), description: stringOrExpression.optional(), end_date: stringOrExpression.optional(), featured_image_url: stringOrExpression.optional(), instructions: stringOrExpression.optional(), location: z.object({ postal_addresses_fields: z.object({ primary: booleanOrExpression.optional(), address_lines: stringOrExpression.optional(), locality: stringOrExpression.optional(), region: stringOrExpression.optional(), postal_code: stringOrExpression.optional(), country: stringOrExpression.optional(), language: stringOrExpression.optional(), location: z.object({ location_fields: z.object({ latitude: stringOrExpression.optional(), longitude: stringOrExpression.optional() }).optional() }).optional() }).optional() }).optional(), name: stringOrExpression.optional(), start_date: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
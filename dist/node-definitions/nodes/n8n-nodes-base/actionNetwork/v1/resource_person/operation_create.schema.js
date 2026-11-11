/**
 * Action Network Node - Version 1 - Zod Schema
 * Discriminator: resource=person, operation=create
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
      resource: z.literal('person'),
      operation: z.literal('create').default('create'),
      simple: booleanOrExpression.optional(),
      email_addresses: z.object({ email_addresses_fields: z.object({ address: stringOrExpression.optional(), primary: z.unknown().optional(), status: z.union([z.literal('bouncing'), z.literal('previous bounce'), z.literal('previous spam complaint'), z.literal('spam complaint'), z.literal('subscribed'), z.literal('unsubscribed'), expressionSchema]).optional() }).optional() }).optional(),
      additionalFields: z.object({ family_name: stringOrExpression.optional(), given_name: stringOrExpression.optional(), languages_spoken: z.union([z.literal('da'), z.literal('nl'), z.literal('en'), z.literal('fi'), z.literal('fr'), z.literal('de'), z.literal('hu'), z.literal('id'), z.literal('ja'), z.literal('pt'), z.literal('br'), z.literal('ru'), z.literal('es'), z.literal('sv'), z.literal('tr'), z.literal('cy'), expressionSchema]).optional(), phone_numbers: z.object({ phone_numbers_fields: z.object({ number: stringOrExpression.optional(), primary: z.unknown().optional(), status: z.union([z.literal('bouncing'), z.literal('previous bounce'), z.literal('subscribed'), z.literal('unsubscribed'), expressionSchema]).optional() }).optional() }).optional(), postal_addresses: z.object({ postal_addresses_fields: z.array(z.object({ primary: booleanOrExpression.optional(), address_lines: stringOrExpression.optional(), locality: stringOrExpression.optional(), region: stringOrExpression.optional(), postal_code: stringOrExpression.optional(), country: stringOrExpression.optional(), language: stringOrExpression.optional(), location: z.object({ location_fields: z.object({ latitude: stringOrExpression.optional(), longitude: stringOrExpression.optional() }).optional() }).optional() })).optional() }).optional() }).optional(),
    }).optional(),
  });
};
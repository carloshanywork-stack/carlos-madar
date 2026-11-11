/**
 * Autopilot Node - Version 1 - Zod Schema
 * Discriminator: resource=contact, operation=upsert
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
      operation: z.literal('upsert').default('upsert'),
      email: stringOrExpression,
      additionalFields: z.object({ Company: stringOrExpression.optional(), customFieldsUi: z.array(stringOrExpression).optional(), Fax: stringOrExpression.optional(), FirstName: stringOrExpression.optional(), Industry: stringOrExpression.optional(), LastName: stringOrExpression.optional(), LeadSource: stringOrExpression.optional(), LinkedIn: stringOrExpression.optional(), autopilotList: stringOrExpression.optional(), MailingCountry: stringOrExpression.optional(), MailingPostalCode: stringOrExpression.optional(), MailingState: stringOrExpression.optional(), MailingStreet: stringOrExpression.optional(), MailingCity: stringOrExpression.optional(), MobilePhone: stringOrExpression.optional(), newEmail: stringOrExpression.optional(), notify: booleanOrExpression.optional(), NumberOfEmployees: numberOrExpression.optional(), owner_name: stringOrExpression.optional(), Phone: stringOrExpression.optional(), Salutation: stringOrExpression.optional(), autopilotSessionId: stringOrExpression.optional(), Status: stringOrExpression.optional(), Title: stringOrExpression.optional(), unsubscribed: booleanOrExpression.optional(), Website: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
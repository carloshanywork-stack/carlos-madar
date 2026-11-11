/**
 * Clearbit Node - Version 1 - Zod Schema
 * Discriminator: resource=person, operation=enrich
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
      operation: z.literal('enrich').default('enrich'),
      email: stringOrExpression,
      additionalFields: z.object({ company: stringOrExpression.optional(), companyDomain: stringOrExpression.optional(), facebook: stringOrExpression.optional(), familyName: stringOrExpression.optional(), givenName: stringOrExpression.optional(), ipAddress: stringOrExpression.optional(), location: stringOrExpression.optional(), linkedIn: stringOrExpression.optional(), twitter: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
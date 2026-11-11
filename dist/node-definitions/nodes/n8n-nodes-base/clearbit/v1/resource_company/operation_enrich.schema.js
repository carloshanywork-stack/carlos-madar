/**
 * Clearbit Node - Version 1 - Zod Schema
 * Discriminator: resource=company, operation=enrich
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
      resource: z.literal('company').default('company'),
      operation: z.literal('enrich').default('enrich'),
      domain: stringOrExpression,
      additionalFields: z.object({ companyName: stringOrExpression.optional(), facebook: stringOrExpression.optional(), linkedin: stringOrExpression.optional(), twitter: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
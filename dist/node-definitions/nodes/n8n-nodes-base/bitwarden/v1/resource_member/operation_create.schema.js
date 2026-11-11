/**
 * Bitwarden Node - Version 1 - Zod Schema
 * Discriminator: resource=member, operation=create
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
      resource: z.literal('member'),
      operation: z.literal('create'),
      type: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), expressionSchema]).optional(),
      email: stringOrExpression.optional(),
      accessAll: booleanOrExpression.optional(),
      additionalFields: z.object({ collections: z.array(z.string()).optional(), externalId: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
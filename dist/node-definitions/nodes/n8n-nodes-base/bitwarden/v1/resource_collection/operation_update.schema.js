/**
 * Bitwarden Node - Version 1 - Zod Schema
 * Discriminator: resource=collection, operation=update
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
      resource: z.literal('collection').default('collection'),
      operation: z.literal('update'),
      collectionId: stringOrExpression,
      updateFields: z.object({ groups: z.array(z.string()).optional(), externalId: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
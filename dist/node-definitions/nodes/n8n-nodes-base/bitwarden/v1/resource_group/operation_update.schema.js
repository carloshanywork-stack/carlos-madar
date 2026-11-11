/**
 * Bitwarden Node - Version 1 - Zod Schema
 * Discriminator: resource=group, operation=update
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
      resource: z.literal('group'),
      operation: z.literal('update'),
      groupId: stringOrExpression,
      updateFields: z.object({ accessAll: booleanOrExpression.optional(), collections: z.array(z.string()).optional(), externalId: stringOrExpression.optional(), name: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
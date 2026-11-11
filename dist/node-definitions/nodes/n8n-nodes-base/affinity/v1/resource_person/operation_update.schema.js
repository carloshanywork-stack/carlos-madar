/**
 * Affinity Node - Version 1 - Zod Schema
 * Discriminator: resource=person, operation=update
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
      operation: z.literal('update'),
      personId: stringOrExpression,
      updateFields: z.object({ firstName: stringOrExpression.optional(), lastName: stringOrExpression.optional(), organizations: z.array(z.string()).optional() }).optional(),
      emails: z.array(stringOrExpression).optional(),
    }).optional(),
  });
};
/**
 * Clockify Node - Version 1 - Zod Schema
 * Discriminator: resource=timeEntry, operation=get
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
      resource: z.literal('timeEntry'),
      operation: z.literal('get'),
      workspaceId: stringOrExpression.optional(),
      timeEntryId: stringOrExpression,
      additionalFields: z.object({ 'consider-duration-format': booleanOrExpression.optional(), hydrated: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
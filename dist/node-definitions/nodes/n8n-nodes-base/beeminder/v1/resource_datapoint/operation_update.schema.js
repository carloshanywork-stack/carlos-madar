/**
 * Beeminder Node - Version 1 - Zod Schema
 * Discriminator: resource=datapoint, operation=update
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
      resource: z.literal('datapoint').default('datapoint'),
      operation: z.literal('update'),
      authentication: z.union([z.literal('apiToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      goalName: stringOrExpression,
      datapointId: stringOrExpression,
      updateFields: z.object({ value: numberOrExpression.optional(), comment: stringOrExpression.optional(), timestamp: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
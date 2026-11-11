/**
 * ClickUp Node - Version 1 - Zod Schema
 * Discriminator: resource=goalKeyResult, operation=update
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
      resource: z.literal('goalKeyResult'),
      operation: z.literal('update'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      keyResult: stringOrExpression,
      updateFields: z.object({ name: stringOrExpression.optional(), note: stringOrExpression.optional(), stepsCurrent: numberOrExpression.optional(), stepsEnd: numberOrExpression.optional(), stepsStart: numberOrExpression.optional(), unit: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
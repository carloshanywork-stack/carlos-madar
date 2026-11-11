/**
 * ClickUp Node - Version 1 - Zod Schema
 * Discriminator: resource=goalKeyResult, operation=create
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
      operation: z.literal('create').default('create'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      goal: stringOrExpression,
      name: stringOrExpression,
      type: z.union([z.literal('automatic'), z.literal('boolean'), z.literal('currency'), z.literal('number'), z.literal('percentage'), expressionSchema]),
      additionalFields: z.object({ listIds: stringOrExpression.optional(), owners: stringOrExpression.optional(), stepsStart: numberOrExpression.optional(), stepsEnd: numberOrExpression.optional(), taskIds: stringOrExpression.optional(), unit: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
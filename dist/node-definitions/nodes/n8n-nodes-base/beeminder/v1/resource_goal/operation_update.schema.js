/**
 * Beeminder Node - Version 1 - Zod Schema
 * Discriminator: resource=goal, operation=update
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
      resource: z.literal('goal'),
      operation: z.literal('update'),
      authentication: z.union([z.literal('apiToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      goalName: stringOrExpression,
      updateFields: z.object({ title: stringOrExpression.optional(), yaxis: stringOrExpression.optional(), tmin: stringOrExpression.optional(), tmax: stringOrExpression.optional(), secret: booleanOrExpression.optional(), datapublic: booleanOrExpression.optional(), roadall: z.union([iDataObjectSchema, z.string()]).optional(), datasource: z.union([z.literal('api'), z.literal('ifttt'), z.literal('zapier'), z.literal(''), expressionSchema]).optional(), tags: z.union([iDataObjectSchema, z.string()]).optional() }).optional(),
    }).optional(),
  });
};
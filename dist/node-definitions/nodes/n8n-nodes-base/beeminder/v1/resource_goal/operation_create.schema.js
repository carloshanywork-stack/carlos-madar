/**
 * Beeminder Node - Version 1 - Zod Schema
 * Discriminator: resource=goal, operation=create
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
      operation: z.literal('create'),
      authentication: z.union([z.literal('apiToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      slug: stringOrExpression,
      title: stringOrExpression,
      goal_type: z.union([z.literal('hustler'), z.literal('biker'), z.literal('fatloser'), z.literal('gainer'), z.literal('inboxer'), z.literal('drinker'), z.literal('custom'), expressionSchema]).optional(),
      gunits: stringOrExpression,
      additionalFields: z.object({ goaldate: stringOrExpression.optional(), goalval: numberOrExpression.optional(), rate: numberOrExpression.optional(), initval: numberOrExpression.optional(), secret: booleanOrExpression.optional(), datapublic: booleanOrExpression.optional(), datasource: z.union([z.literal('api'), z.literal('ifttt'), z.literal('zapier'), z.literal('manual'), expressionSchema]).optional(), dryrun: booleanOrExpression.optional(), tags: z.union([iDataObjectSchema, z.string()]).optional() }).optional(),
    }).optional(),
  });
};
/**
 * ClickUp Node - Version 1 - Zod Schema
 * Discriminator: resource=timeEntryTag, operation=add
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
      resource: z.literal('timeEntryTag'),
      operation: z.literal('add').default('add'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      team: stringOrExpression,
      timeEntryIds: stringOrExpression,
      tagsUi: z.object({ tagsValues: z.array(z.object({ name: stringOrExpression.optional(), tag_bg: stringOrExpression.optional(), tag_fg: stringOrExpression.optional() })).optional() }).optional(),
    }).optional(),
  });
};
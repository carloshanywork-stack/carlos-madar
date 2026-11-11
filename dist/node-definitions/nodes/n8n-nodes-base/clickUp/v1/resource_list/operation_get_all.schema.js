/**
 * ClickUp Node - Version 1 - Zod Schema
 * Discriminator: resource=list, operation=getAll
 *
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema, resolveSchema, resolveOneOfSchemas }) {

  return z.object({
    parameters: z.object({
      resource: z.literal('list'),
      operation: z.literal('getAll'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      team: stringOrExpression,
      space: stringOrExpression,
      folderless: booleanOrExpression.optional(),
      folder: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"folderless":[false]}}, defaults: {"folderless":false} }),
      limit: numberOrExpression.optional(),
      filters: z.object({ archived: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
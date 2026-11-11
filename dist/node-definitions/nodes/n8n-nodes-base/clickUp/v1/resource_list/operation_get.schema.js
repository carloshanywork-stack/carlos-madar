/**
 * ClickUp Node - Version 1 - Zod Schema
 * Discriminator: resource=list, operation=get
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
      operation: z.literal('get'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      team: stringOrExpression,
      space: stringOrExpression,
      folderless: booleanOrExpression.optional(),
      folder: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"folderless":[false]}}, defaults: {"folderless":false} }),
      list: stringOrExpression,
    }).optional(),
  });
};
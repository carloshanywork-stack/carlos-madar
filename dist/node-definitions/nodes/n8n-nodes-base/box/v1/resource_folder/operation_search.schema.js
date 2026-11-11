/**
 * Box Node - Version 1 - Zod Schema
 * Discriminator: resource=folder, operation=search
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
      resource: z.literal('folder'),
      operation: z.literal('search'),
      query: stringOrExpression.optional(),
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      additionalFields: z.object({ contet_types: stringOrExpression.optional(), createdRangeUi: z.object({ createdRangeValuesUi: z.object({ from: stringOrExpression.optional(), to: stringOrExpression.optional() }).optional() }).optional(), direction: z.union([z.literal('ASC'), z.literal('DESC'), expressionSchema]).optional(), fields: stringOrExpression.optional(), file_extensions: stringOrExpression.optional(), ancestor_folder_ids: stringOrExpression.optional(), scope: z.union([z.literal('user_content'), z.literal('enterprise_content'), expressionSchema]).optional(), size_range: stringOrExpression.optional(), sort: z.union([z.literal('relevance'), z.literal('modified_at'), expressionSchema]).optional(), trash_content: z.union([z.literal('non_trashed_only'), z.literal('trashed_only'), expressionSchema]).optional(), updatedRangeUi: z.object({ updatedRangeValuesUi: z.object({ from: stringOrExpression.optional(), to: stringOrExpression.optional() }).optional() }).optional(), owner_user_ids: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
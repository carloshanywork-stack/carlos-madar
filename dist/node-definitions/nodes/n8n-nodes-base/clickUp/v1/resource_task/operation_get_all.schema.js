/**
 * ClickUp Node - Version 1 - Zod Schema
 * Discriminator: resource=task, operation=getAll
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
      resource: z.literal('task').default('task'),
      operation: z.literal('getAll'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      team: stringOrExpression,
      space: stringOrExpression,
      folderless: booleanOrExpression.optional(),
      folder: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"folderless":[false]}}, defaults: {"folderless":false} }),
      list: resolveOneOfSchemas({ parameters, variants: [{ schema: stringOrExpression, required: true, displayOptions: {"show":{"folderless":[true]}}, defaults: {"folderless":false} }, { schema: stringOrExpression, required: true, displayOptions: {"show":{"folderless":[false]}}, defaults: {"folderless":false} }] }),
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":true} }),
      filters: z.object({ archived: booleanOrExpression.optional(), assignees: z.array(z.string()).optional(), customFieldsUi: z.object({ customFieldsValues: z.array(z.object({ fieldId: stringOrExpression.optional(), operator: z.union([z.literal('!='), z.literal('<'), z.literal('<='), z.literal('>'), z.literal('>='), z.literal('equal'), z.literal('IS NOT NULL'), z.literal('IS NULL'), expressionSchema]).optional(), value: stringOrExpression.optional() })).optional() }).optional(), dateCreatedGt: stringOrExpression.optional(), dateCreatedLt: stringOrExpression.optional(), dateUpdatedGt: stringOrExpression.optional(), dateUpdatedLt: stringOrExpression.optional(), dueDateGt: stringOrExpression.optional(), dueDateLt: stringOrExpression.optional(), includeClosed: booleanOrExpression.optional(), orderBy: z.union([z.literal('id'), z.literal('created'), z.literal('updated'), z.literal('dueDate'), expressionSchema]).optional(), statuses: z.array(z.string()).optional(), subtasks: booleanOrExpression.optional(), tags: z.array(z.string()).optional() }).optional(),
    }).optional(),
  });
};
/**
 * Asana Node - Version 1 - Zod Schema
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
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      filters: z.object({ assignee: stringOrExpression.optional(), opt_fields: z.array(z.string()).optional(), opt_pretty: booleanOrExpression.optional(), project: stringOrExpression.optional(), section: stringOrExpression.optional(), workspace: stringOrExpression.optional(), completed_since: stringOrExpression.optional(), modified_since: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
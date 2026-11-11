/**
 * Webex by Cisco Node - Version 1 - Zod Schema
 * Discriminator: resource=message, operation=getAll
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
      resource: z.literal('message').default('message'),
      operation: z.literal('getAll'),
      roomId: stringOrExpression,
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      filters: z.object({ before: stringOrExpression.optional(), beforeMessage: stringOrExpression.optional(), parentId: stringOrExpression.optional(), mentionedPeople: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
/**
 * Webex by Cisco Node - Version 1 - Zod Schema
 * Discriminator: resource=message, operation=update
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
      operation: z.literal('update'),
      messageId: stringOrExpression,
      markdown: booleanOrExpression.optional(),
      text: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"markdown":[false]}}, defaults: {"markdown":false} }),
      markdownText: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"markdown":[true]}}, defaults: {"markdown":false} }),
    }).optional(),
  });
};
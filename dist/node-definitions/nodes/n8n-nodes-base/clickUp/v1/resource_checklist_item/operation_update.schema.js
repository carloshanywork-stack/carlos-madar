/**
 * ClickUp Node - Version 1 - Zod Schema
 * Discriminator: resource=checklistItem, operation=update
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
      resource: z.literal('checklistItem'),
      operation: z.literal('update'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      checklist: stringOrExpression,
      checklistItem: stringOrExpression,
      updateFields: z.object({ assignee: stringOrExpression.optional(), name: stringOrExpression.optional(), parent: stringOrExpression.optional(), resolved: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
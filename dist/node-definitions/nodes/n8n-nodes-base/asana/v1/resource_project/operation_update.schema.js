/**
 * Asana Node - Version 1 - Zod Schema
 * Discriminator: resource=project, operation=update
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
      resource: z.literal('project'),
      operation: z.literal('update'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      workspace: stringOrExpression,
      id: stringOrExpression,
      updateFields: z.object({ color: z.union([z.literal('dark-blue'), z.literal('dark-brown'), z.literal('dark-green'), z.literal('dark-orange'), z.literal('dark-pink'), z.literal('dark-purple'), z.literal('dark-red'), z.literal('dark-teal'), z.literal('dark-warm-gray'), z.literal('light-blue'), z.literal('light-green'), z.literal('light-orange'), z.literal('light-pink'), z.literal('light-purple'), z.literal('light-red'), z.literal('light-teal'), z.literal('light-warm-gray'), z.literal('light-yellow'), z.literal('none'), expressionSchema]).optional(), due_on: stringOrExpression.optional(), name: stringOrExpression.optional(), notes: stringOrExpression.optional(), owner: stringOrExpression.optional(), privacy_setting: z.union([z.literal('private'), z.literal('private_to_team'), z.literal('public_to_workspace'), expressionSchema]).optional(), team: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
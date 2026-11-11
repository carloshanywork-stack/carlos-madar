/**
 * Box Node - Version 1 - Zod Schema
 * Discriminator: resource=folder, operation=update
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
      resource: z.literal('folder'),
      operation: z.literal('update'),
      folderId: stringOrExpression,
      updateFields: z.object({ can_non_owners_invite: booleanOrExpression.optional(), can_non_owners_view_collaborators: booleanOrExpression.optional(), description: stringOrExpression.optional(), fields: stringOrExpression.optional(), is_collaboration_restricted_to_enterprise: booleanOrExpression.optional(), name: stringOrExpression.optional(), parentId: stringOrExpression.optional(), shared_link: z.object({ access: z.union([z.literal('collaborators'), z.literal('company'), z.literal('open'), expressionSchema]).optional(), password: stringOrExpression.optional(), permissions: z.object({ can_download: booleanOrExpression.optional(), unshared_at: stringOrExpression.optional(), vanity_name: stringOrExpression.optional() }).optional(), tags: stringOrExpression.optional() }).optional() }).optional(),
    }).optional(),
  });
};
/**
 * Box Node - Version 1 - Zod Schema
 * Discriminator: resource=file, operation=share
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
      resource: z.literal('file').default('file'),
      operation: z.literal('share'),
      fileId: stringOrExpression.optional(),
      accessibleBy: z.union([z.literal('group'), z.literal('user'), expressionSchema]).optional(),
      useEmail: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"accessibleBy":["user"]}}, defaults: {"accessibleBy":""} }),
      email: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"useEmail":[true],"accessibleBy":["user"]}}, defaults: {"useEmail":true,"accessibleBy":""} }),
      userId: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"useEmail":[false],"accessibleBy":["user"]}}, defaults: {"useEmail":true,"accessibleBy":""} }),
      groupId: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"accessibleBy":["group"]}}, defaults: {"accessibleBy":""} }),
      role: z.union([z.literal('coOwner'), z.literal('editor'), z.literal('previewer'), z.literal('previewerUploader'), z.literal('uploader'), z.literal('viewer'), z.literal('viewerUploader'), expressionSchema]).optional(),
      options: z.object({ can_view_path: booleanOrExpression.optional(), expires_at: stringOrExpression.optional(), fields: stringOrExpression.optional(), notify: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
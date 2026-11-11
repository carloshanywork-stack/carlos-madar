/**
 * Webex by Cisco Trigger Node - Version 1 - Zod Validation Schemas
 *
 * These schemas validate node configuration at runtime.
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema, resolveSchema, resolveOneOfSchemas }) {

  // Parameters schema
  const parametersSchema = z.object({
    resource: z.union([z.literal('all'), z.literal('attachmentAction'), z.literal('meeting'), z.literal('membership'), z.literal('message'), z.literal('recording'), z.literal('room')]).optional(),
    event: resolveOneOfSchemas({ parameters, variants: [{ schema: z.union([z.literal('created'), z.literal('deleted'), z.literal('updated'), z.literal('all'), expressionSchema]), required: true, displayOptions: {"show":{"resource":["attachmentAction"]}}, defaults: {"resource":"meeting"} }, { schema: z.union([z.literal('created'), z.literal('deleted'), z.literal('updated'), z.literal('all'), expressionSchema]), required: true, displayOptions: {"show":{"resource":["membership"]}}, defaults: {"resource":"meeting"} }, { schema: z.union([z.literal('created'), z.literal('deleted'), z.literal('updated'), z.literal('all'), expressionSchema]), required: true, displayOptions: {"show":{"resource":["message"]}}, defaults: {"resource":"meeting"} }, { schema: z.union([z.literal('created'), z.literal('deleted'), z.literal('updated'), z.literal('all'), expressionSchema]), required: true, displayOptions: {"show":{"resource":["room"]}}, defaults: {"resource":"meeting"} }, { schema: z.union([z.literal('created'), z.literal('deleted'), z.literal('updated'), z.literal('started'), z.literal('ended'), z.literal('all'), expressionSchema]), required: true, displayOptions: {"show":{"resource":["meeting"]}}, defaults: {"resource":"meeting"} }, { schema: z.union([z.literal('created'), z.literal('deleted'), z.literal('updated'), z.literal('all'), expressionSchema]), required: true, displayOptions: {"show":{"resource":["recording"]}}, defaults: {"resource":"meeting"} }, { schema: z.union([z.literal('created'), z.literal('deleted'), z.literal('updated'), expressionSchema]), required: true, displayOptions: {"show":{"resource":["telephonyCall"]}}, defaults: {"resource":"meeting"} }, { schema: z.union([z.literal('created'), z.literal('updated'), z.literal('deleted'), z.literal('all'), expressionSchema]), required: true, displayOptions: {"show":{"resource":["all"]}}, defaults: {"resource":"meeting"} }] }),
    resolveData: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"resource":["attachmentAction"]}}, defaults: {"resource":"meeting"} }),
    filters: z.object({ hasFiles: booleanOrExpression.optional(), isLocked: booleanOrExpression.optional(), isModerator: booleanOrExpression.optional(), mentionedPeople: stringOrExpression.optional(), messageId: stringOrExpression.optional(), ownedBy: stringOrExpression.optional(), personEmail: stringOrExpression.optional(), personId: stringOrExpression.optional(), roomId: stringOrExpression.optional(), roomType: z.union([z.literal('direct'), z.literal('group'), expressionSchema]).optional(), type: z.union([z.literal('direct'), z.literal('group'), expressionSchema]).optional() }).optional(),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
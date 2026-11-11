/**
 * ClickUp Trigger Node - Version 1 - Zod Validation Schemas
 *
 * These schemas validate node configuration at runtime.
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema }) {

  // Parameters schema
  const parametersSchema = z.object({
    authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
    team: stringOrExpression,
    events: z.array(z.union([z.literal('*'), z.literal('folderCreated'), z.literal('folderDeleted'), z.literal('folderUpdated'), z.literal('goalCreated'), z.literal('goalDeleted'), z.literal('goalUpdated'), z.literal('keyResultCreated'), z.literal('keyResultDelete'), z.literal('keyResultUpdated'), z.literal('listCreated'), z.literal('listDeleted'), z.literal('listUpdated'), z.literal('spaceCreated'), z.literal('spaceDeleted'), z.literal('spaceUpdated'), z.literal('taskAssigneeUpdated'), z.literal('taskCommentPosted'), z.literal('taskCommentUpdated'), z.literal('taskCreated'), z.literal('taskDeleted'), z.literal('taskDueDateUpdated'), z.literal('taskMoved'), z.literal('taskStatusUpdated'), z.literal('taskTagUpdated'), z.literal('taskTimeEstimateUpdated'), z.literal('taskTimeTrackedUpdated'), z.literal('taskUpdated')])),
    filters: z.object({ folderId: stringOrExpression.optional(), listId: stringOrExpression.optional(), spaceId: stringOrExpression.optional(), taskId: stringOrExpression.optional() }).optional(),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
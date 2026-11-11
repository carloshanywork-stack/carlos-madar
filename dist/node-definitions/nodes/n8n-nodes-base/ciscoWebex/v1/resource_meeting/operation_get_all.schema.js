/**
 * Webex by Cisco Node - Version 1 - Zod Schema
 * Discriminator: resource=meeting, operation=getAll
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
      resource: z.literal('meeting'),
      operation: z.literal('getAll'),
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      filters: z.object({ from: stringOrExpression.optional(), hostEmail: stringOrExpression.optional(), integrationTag: stringOrExpression.optional(), current: booleanOrExpression.optional(), meetingNumber: stringOrExpression.optional(), meetingType: z.union([z.literal('meetingSeries'), z.literal('scheduledMeeting'), z.literal('meeting'), expressionSchema]).optional(), participantEmail: stringOrExpression.optional(), siteUrl: stringOrExpression.optional(), state: z.union([z.literal('active'), z.literal('ended'), z.literal('expired'), z.literal('inProgress'), z.literal('lobby'), z.literal('missed'), z.literal('ready'), z.literal('scheduled'), expressionSchema]).optional(), to: stringOrExpression.optional(), webLink: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
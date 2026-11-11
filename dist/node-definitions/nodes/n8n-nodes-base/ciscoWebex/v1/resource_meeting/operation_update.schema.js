/**
 * Webex by Cisco Node - Version 1 - Zod Schema
 * Discriminator: resource=meeting, operation=update
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
      resource: z.literal('meeting'),
      operation: z.literal('update'),
      meetingId: stringOrExpression,
      updateFields: z.object({ agenda: stringOrExpression.optional(), allowAnyUserToBeCoHost: booleanOrExpression.optional(), allowAuthenticatedDevices: booleanOrExpression.optional(), allowFirstUserToBeCoHost: booleanOrExpression.optional(), enableConnectAudioBeforeHost: booleanOrExpression.optional(), enabledAutoRecordMeeting: booleanOrExpression.optional(), enabledJoinBeforeHost: booleanOrExpression.optional(), end: stringOrExpression.optional(), excludePassword: booleanOrExpression.optional(), hostEmail: stringOrExpression.optional(), inviteesUi: z.object({ inviteeValues: z.array(z.object({ email: stringOrExpression.optional(), displayName: stringOrExpression.optional(), coHost: booleanOrExpression.optional() })).optional() }).optional(), joinBeforeHostMinutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15), expressionSchema]).optional(), password: stringOrExpression.optional(), publicMeeting: booleanOrExpression.optional(), recurrence: stringOrExpression.optional(), requireRegistrationInfo: z.array(z.union([z.literal('requireFirstName'), z.literal('requireLastName'), z.literal('requireEmail'), z.literal('requireJobTitle'), z.literal('requireCompanyName'), z.literal('requireAddress1'), z.literal('requireAddress2'), z.literal('requireCity'), z.literal('requireState'), z.literal('requireZipCode'), z.literal('requireCountryRegion'), z.literal('requireWorkPhone'), z.literal('requireFax')])).optional(), reminderTime: numberOrExpression.optional(), sendEmail: booleanOrExpression.optional(), siteUrl: stringOrExpression.optional(), start: stringOrExpression.optional(), title: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
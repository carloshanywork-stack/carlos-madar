/**
 * Webex by Cisco Node - Version 1 - Zod Schema
 * Discriminator: resource=meeting, operation=delete
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
      operation: z.literal('delete'),
      meetingId: stringOrExpression,
      options: z.object({ hostEmail: stringOrExpression.optional(), sendEmail: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
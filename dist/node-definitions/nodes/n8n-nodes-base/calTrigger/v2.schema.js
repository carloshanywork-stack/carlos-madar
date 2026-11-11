/**
 * Cal.com Trigger Node - Version 2 - Zod Validation Schemas
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
    events: z.array(z.union([z.literal('BOOKING_CANCELLED'), z.literal('BOOKING_CREATED'), z.literal('BOOKING_RESCHEDULED'), z.literal('MEETING_ENDED')])),
    version: z.union([z.literal(1), z.literal(2), expressionSchema]).optional(),
    options: z.object({ appId: stringOrExpression.optional(), eventTypeId: stringOrExpression.optional(), payloadTemplate: stringOrExpression.optional() }).optional(),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
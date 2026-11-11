/**
 * Acuity Scheduling Trigger Node - Version 1 - Zod Validation Schemas
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
    authentication: z.union([z.literal('apiKey'), z.literal('oAuth2'), expressionSchema]).optional(),
    event: z.union([z.literal('appointment.canceled'), z.literal('appointment.changed'), z.literal('appointment.rescheduled'), z.literal('appointment.scheduled'), z.literal('order.completed'), expressionSchema]),
    resolveData: booleanOrExpression.optional(),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
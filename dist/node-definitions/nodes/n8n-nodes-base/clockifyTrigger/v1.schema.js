/**
 * Clockify Trigger Node - Version 1 - Zod Validation Schemas
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
    pollTimes: z.object({ item: z.array(z.object({ mode: z.union([z.literal('everyMinute'), z.literal('everyHour'), z.literal('everyDay'), z.literal('everyWeek'), z.literal('everyMonth'), z.literal('everyX'), z.literal('custom'), expressionSchema]).optional(), hour: numberOrExpression.optional(), minute: numberOrExpression.optional(), dayOfMonth: numberOrExpression.optional(), weekday: z.union([z.literal('1'), z.literal('2'), z.literal('3'), z.literal('4'), z.literal('5'), z.literal('6'), z.literal('0'), expressionSchema]).optional(), cronExpression: stringOrExpression.optional(), value: numberOrExpression.optional(), unit: z.union([z.literal('minutes'), z.literal('hours'), expressionSchema]).optional() })).optional() }).optional(),
    workspaceId: stringOrExpression,
    watchField: z.union([z.literal(0), expressionSchema]).optional(),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
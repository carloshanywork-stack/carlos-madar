/**
 * Airtable Trigger Node - Version 1 - Zod Validation Schemas
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
    pollTimes: z.object({ item: z.array(z.object({ mode: z.union([z.literal('everyMinute'), z.literal('everyHour'), z.literal('everyDay'), z.literal('everyWeek'), z.literal('everyMonth'), z.literal('everyX'), z.literal('custom'), expressionSchema]).optional(), hour: numberOrExpression.optional(), minute: numberOrExpression.optional(), dayOfMonth: numberOrExpression.optional(), weekday: z.union([z.literal('1'), z.literal('2'), z.literal('3'), z.literal('4'), z.literal('5'), z.literal('6'), z.literal('0'), expressionSchema]).optional(), cronExpression: stringOrExpression.optional(), value: numberOrExpression.optional(), unit: z.union([z.literal('minutes'), z.literal('hours'), expressionSchema]).optional() })).optional() }).optional(),
    authentication: z.union([z.literal('airtableApi'), z.literal('airtableTokenApi'), z.literal('airtableOAuth2Api'), expressionSchema]).optional(),
    baseId: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('url'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
    tableId: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('url'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
    triggerField: stringOrExpression,
    downloadAttachments: booleanOrExpression.optional(),
    downloadFieldNames: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"downloadAttachments":[true]}}, defaults: {"downloadAttachments":false} }),
    additionalFields: z.object({ fields: stringOrExpression.optional(), formula: stringOrExpression.optional(), viewId: stringOrExpression.optional() }).optional(),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
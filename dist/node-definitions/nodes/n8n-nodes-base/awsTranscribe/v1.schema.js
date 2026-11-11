/**
 * AWS Transcribe Node - Version 1 - Zod Validation Schemas
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
    authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
    resource: z.union([z.literal('transcriptionJob')]).optional(),
    operation: z.union([z.literal('create'), z.literal('delete'), z.literal('get'), z.literal('getAll')]).optional(),
    transcriptionJobName: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"resource":["transcriptionJob"],"operation":["create","get","delete"]}}, defaults: {"resource":"transcriptionJob","operation":"create"} }),
    mediaFileUri: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"resource":["transcriptionJob"],"operation":["create"]}}, defaults: {"resource":"transcriptionJob","operation":"create"} }),
    detectLanguage: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"resource":["transcriptionJob"],"operation":["create"]}}, defaults: {"resource":"transcriptionJob","operation":"create"} }),
    languageCode: resolveSchema({ parameters, schema: z.union([z.literal('en-US'), z.literal('en-GB'), z.literal('de-DE'), z.literal('en-IN'), z.literal('en-IE'), z.literal('ru-RU'), z.literal('es-ES'), expressionSchema]), required: false, displayOptions: {"show":{"resource":["transcriptionJob"],"operation":["create"],"detectLanguage":[false]}}, defaults: {"resource":"transcriptionJob","operation":"create","detectLanguage":false} }),
    options: resolveSchema({ parameters, schema: z.object({ channelIdentification: booleanOrExpression.optional(), maxAlternatives: numberOrExpression.optional(), maxSpeakerLabels: numberOrExpression.optional(), vocabularyName: stringOrExpression.optional(), vocabularyFilterName: stringOrExpression.optional(), vocabularyFilterMethod: z.union([z.literal('remove'), z.literal('mask'), z.literal('tag'), expressionSchema]).optional() }), required: false, displayOptions: {"show":{"operation":["create"]}}, defaults: {"operation":"create"} }),
    returnTranscript: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"resource":["transcriptionJob"],"operation":["get"]}}, defaults: {"resource":"transcriptionJob","operation":"create"} }),
    simple: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"resource":["transcriptionJob"],"operation":["get"],"returnTranscript":[true]}}, defaults: {"resource":"transcriptionJob","operation":"create","returnTranscript":true} }),
    returnAll: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"resource":["transcriptionJob"],"operation":["getAll"]}}, defaults: {"resource":"transcriptionJob","operation":"create"} }),
    limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"resource":["transcriptionJob"],"operation":["getAll"],"returnAll":[false]}}, defaults: {"resource":"transcriptionJob","operation":"create","returnAll":false} }),
    filters: resolveSchema({ parameters, schema: z.object({ jobNameContains: stringOrExpression.optional(), status: z.union([z.literal('COMPLETED'), z.literal('FAILED'), z.literal('IN_PROGRESS'), z.literal('QUEUED'), expressionSchema]).optional() }), required: false, displayOptions: {"show":{"resource":["transcriptionJob"],"operation":["getAll"]}}, defaults: {"resource":"transcriptionJob","operation":"create"} }),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
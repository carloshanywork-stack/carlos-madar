/**
 * AWS Rekognition Node - Version 1 - Zod Validation Schemas
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
    resource: z.union([z.literal('image')]).optional(),
    operation: z.union([z.literal('analyze')]).optional(),
    type: resolveSchema({ parameters, schema: z.union([z.literal('detectFaces'), z.literal('detectLabels'), z.literal('detectModerationLabels'), z.literal('detectText'), z.literal('recognizeCelebrity'), expressionSchema]), required: false, displayOptions: {"show":{"operation":["analyze"],"resource":["image"]}}, defaults: {"operation":"analyze","resource":"image"} }),
    binaryData: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"operation":["analyze"],"resource":["image"]}}, defaults: {"operation":"analyze","resource":"image"} }),
    binaryPropertyName: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"operation":["analyze"],"resource":["image"],"binaryData":[true]}}, defaults: {"operation":"analyze","resource":"image","binaryData":false} }),
    bucket: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"operation":["analyze"],"resource":["image"],"binaryData":[false]}}, defaults: {"operation":"analyze","resource":"image","binaryData":false} }),
    name: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"operation":["analyze"],"resource":["image"],"binaryData":[false]}}, defaults: {"operation":"analyze","resource":"image","binaryData":false} }),
    additionalFields: resolveSchema({ parameters, schema: z.object({ regionsOfInterestUi: z.object({ regionsOfInterestValues: z.array(z.object({ height: numberOrExpression.optional(), left: numberOrExpression.optional(), top: numberOrExpression.optional(), Width: numberOrExpression.optional() })).optional() }).optional(), version: stringOrExpression.optional(), wordFilterUi: z.object({ MinBoundingBoxHeight: numberOrExpression.optional(), MinBoundingBoxWidth: numberOrExpression.optional(), MinConfidence: numberOrExpression.optional() }).optional(), maxLabels: numberOrExpression.optional(), minConfidence: numberOrExpression.optional(), attributes: z.array(z.union([z.literal('all'), z.literal('default')])).optional() }), required: false, displayOptions: {"show":{"operation":["analyze"],"resource":["image"]}}, defaults: {"operation":"analyze","resource":"image"} }),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
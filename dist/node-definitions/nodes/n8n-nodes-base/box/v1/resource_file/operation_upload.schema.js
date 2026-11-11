/**
 * Box Node - Version 1 - Zod Schema
 * Discriminator: resource=file, operation=upload
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
      resource: z.literal('file').default('file'),
      operation: z.literal('upload').default('upload'),
      fileName: stringOrExpression.optional(),
      binaryData: booleanOrExpression.optional(),
      fileContent: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"binaryData":[false]}}, defaults: {"binaryData":false} }),
      binaryPropertyName: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"binaryData":[true]}}, defaults: {"binaryData":false} }),
      parentId: stringOrExpression.optional(),
    }).optional(),
  });
};
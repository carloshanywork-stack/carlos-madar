/**
 * Code Node - Version 1 - Zod Schema
 * Discriminator: mode=runOnceForEachItem
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
      mode: z.literal('runOnceForEachItem'),
      language: z.unknown().optional(),
      jsCode: z.string().optional(),
      pythonCode: resolveSchema({ parameters, schema: z.string(), required: false, displayOptions: {"show":{"language":["python","pythonNative"]}}, defaults: {"language":"javaScript"} }),
    }).optional(),
  });
};
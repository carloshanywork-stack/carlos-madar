/**
 * Brandfetch Node - Version 2 - Zod Validation Schemas
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
    operation: z.union([z.literal('logo'), z.literal('colors'), z.literal('data'), z.literal('context')]).optional(),
    type: resolveSchema({ parameters, schema: z.union([z.literal('domain'), z.literal('ticker'), z.literal('crypto'), z.literal('isin'), expressionSchema]), required: false, displayOptions: {"show":{"operation":["logo","colors","data"]}}, defaults: {"operation":"data"} }),
    identifier: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"operation":["colors","data","logo"]}}, defaults: {"operation":"data"} }),
    domain: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"operation":["context"]}}, defaults: {"operation":"data"} }),
    outputFormat: resolveSchema({ parameters, schema: z.union([z.literal('json'), z.literal('markdown'), expressionSchema]), required: false, displayOptions: {"show":{"operation":["context"]}}, defaults: {"operation":"data"} }),
    cachedOnly: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"operation":["context"]}}, defaults: {"operation":"data"} }),
    download: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"operation":["logo"]}}, defaults: {"operation":"data"} }),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
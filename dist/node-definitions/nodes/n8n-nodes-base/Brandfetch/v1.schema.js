/**
 * Brandfetch Node - Version 1 - Zod Validation Schemas
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
    operation: z.union([z.literal('color'), z.literal('company'), z.literal('font'), z.literal('industry'), z.literal('logo')]).optional(),
    domain: stringOrExpression,
    download: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"operation":["logo"]}}, defaults: {"operation":"logo"} }),
    imageTypes: resolveSchema({ parameters, schema: z.array(z.union([z.literal('icon'), z.literal('logo')])), required: false, displayOptions: {"show":{"operation":["logo"],"download":[true]}}, defaults: {"operation":"logo","download":false} }),
    imageFormats: resolveSchema({ parameters, schema: z.array(z.union([z.literal('png'), z.literal('svg')])), required: false, displayOptions: {"show":{"operation":["logo"],"download":[true]}}, defaults: {"operation":"logo","download":false} }),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
/**
 * AWS Textract Node - Version 1 - Zod Validation Schemas
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
    operation: z.union([z.literal('analyzeExpense')]).optional(),
    binaryPropertyName: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"operation":["analyzeExpense"]}}, defaults: {"operation":"analyzeExpense"} }),
    simple: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"operation":["analyzeExpense"]}}, defaults: {"operation":"analyzeExpense"} }),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
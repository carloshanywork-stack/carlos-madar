/**
 * BambooHR Node - Version 1 - Zod Schema
 * Discriminator: resource=employeeDocument, operation=upload
 *
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema }) {

  return z.object({
    parameters: z.object({
      resource: z.literal('employeeDocument'),
      operation: z.literal('upload'),
      employeeId: stringOrExpression,
      categoryId: stringOrExpression,
      binaryPropertyName: stringOrExpression.optional(),
      options: z.object({ share: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
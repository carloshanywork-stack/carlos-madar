/**
 * BambooHR Node - Version 1 - Zod Schema
 * Discriminator: resource=employeeDocument, operation=update
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
      operation: z.literal('update'),
      employeeId: stringOrExpression,
      fileId: stringOrExpression,
      updateFields: z.object({ categoryId: stringOrExpression.optional(), name: stringOrExpression.optional(), shareWithEmployee: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
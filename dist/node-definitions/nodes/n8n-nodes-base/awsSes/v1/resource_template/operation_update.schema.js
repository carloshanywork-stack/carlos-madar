/**
 * AWS SES Node - Version 1 - Zod Schema
 * Discriminator: resource=template, operation=update
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
      resource: z.literal('template'),
      operation: z.literal('update'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      templateName: stringOrExpression,
      updateFields: z.object({ textPart: stringOrExpression.optional(), subjectPart: stringOrExpression.optional(), htmlPart: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
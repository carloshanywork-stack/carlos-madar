/**
 * Bannerbear Node - Version 1 - Zod Schema
 * Discriminator: resource=image, operation=create
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
      resource: z.literal('image').default('image'),
      operation: z.literal('create').default('create'),
      templateId: stringOrExpression,
      additionalFields: z.object({ metadata: stringOrExpression.optional(), waitForImage: booleanOrExpression.optional(), waitForImageMaxTries: numberOrExpression.optional(), webhookUrl: stringOrExpression.optional() }).optional(),
      modificationsUi: z.object({ modificationsValues: z.array(z.object({ name: stringOrExpression.optional(), text: stringOrExpression.optional(), color: stringOrExpression.optional(), background: stringOrExpression.optional(), imageUrl: stringOrExpression.optional() })).optional() }).optional(),
    }).optional(),
  });
};
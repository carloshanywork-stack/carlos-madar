/**
 * Airtop Node - Version 1 - Zod Schema
 * Discriminator: resource=session, operation=waitForDownload
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
      resource: z.literal('session').default('session'),
      operation: z.literal('waitForDownload'),
      sessionId: stringOrExpression.optional(),
      additionalFields: z.object({ timeout: numberOrExpression.optional() }).optional(),
    }).optional(),
  });
};
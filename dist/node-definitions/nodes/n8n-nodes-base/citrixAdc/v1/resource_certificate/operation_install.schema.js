/**
 * Netscaler ADC Node - Version 1 - Zod Schema
 * Discriminator: resource=certificate, operation=install
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
      resource: z.literal('certificate'),
      operation: z.literal('install'),
      certificateKeyPairName: stringOrExpression,
      certificateFileName: stringOrExpression,
      privateKeyFileName: stringOrExpression,
      certificateFormat: z.union([z.literal('PEM'), z.literal('DER'), expressionSchema]).optional(),
      password: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"certificateFormat":["PEM"]}}, defaults: {"certificateFormat":"PEM"} }),
      notifyExpiration: booleanOrExpression.optional(),
      notificationPeriod: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"notifyExpiration":[true]}}, defaults: {"notifyExpiration":false} }),
      certificateBundle: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"certificateFormat":["PEM"]}}, defaults: {"certificateFormat":"PEM"} }),
    }).optional(),
  });
};
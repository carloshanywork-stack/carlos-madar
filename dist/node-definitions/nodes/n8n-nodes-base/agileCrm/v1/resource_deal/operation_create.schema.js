/**
 * Agile CRM Node - Version 1 - Zod Schema
 * Discriminator: resource=deal, operation=create
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
      resource: z.literal('deal'),
      operation: z.literal('create'),
      closeDate: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"jsonParameters":[false]}}, defaults: {"jsonParameters":false} }),
      expectedValue: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"jsonParameters":[false]}}, defaults: {"jsonParameters":false} }),
      milestone: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"jsonParameters":[false]}}, defaults: {"jsonParameters":false} }),
      name: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"jsonParameters":[false]}}, defaults: {"jsonParameters":false} }),
      probability: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"jsonParameters":[false]}}, defaults: {"jsonParameters":false} }),
      jsonParameters: booleanOrExpression.optional(),
      additionalFieldsJson: resolveSchema({ parameters, schema: z.union([iDataObjectSchema, z.string()]), required: false, displayOptions: {"show":{"jsonParameters":[true]}}, defaults: {"jsonParameters":false} }),
      additionalFields: resolveSchema({ parameters, schema: z.object({ contactIds: z.array(stringOrExpression).optional(), customData: z.object({ customProperty: z.array(z.object({ name: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional() }), required: false, displayOptions: {"show":{"jsonParameters":[false]}}, defaults: {"jsonParameters":false} }),
    }).optional(),
  });
};
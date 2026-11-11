/**
 * Cockpit Node - Version 1 - Zod Schema
 * Discriminator: resource=collection, operation=update
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
      resource: z.literal('collection').default('collection'),
      operation: z.literal('update'),
      collection: stringOrExpression,
      id: stringOrExpression,
      jsonDataFields: booleanOrExpression.optional(),
      dataFieldsJson: resolveSchema({ parameters, schema: z.union([iDataObjectSchema, z.string()]), required: false, displayOptions: {"show":{"jsonDataFields":[true]}}, defaults: {"jsonDataFields":false} }),
      dataFieldsUi: resolveSchema({ parameters, schema: z.object({ field: z.array(z.object({ name: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }), required: false, displayOptions: {"show":{"jsonDataFields":[false]}}, defaults: {"jsonDataFields":false} }),
    }).optional(),
  });
};
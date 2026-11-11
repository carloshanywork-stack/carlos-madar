/**
 * APITemplate.io Node - Version 1 - Zod Schema
 * Discriminator: resource=pdf, operation=create
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
      resource: z.literal('pdf'),
      operation: z.literal('create').default('create'),
      pdfTemplateId: stringOrExpression,
      jsonParameters: booleanOrExpression.optional(),
      download: booleanOrExpression.optional(),
      binaryProperty: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"download":[true]}}, defaults: {"download":false} }),
      propertiesJson: resolveSchema({ parameters, schema: z.union([iDataObjectSchema, z.string()]), required: false, displayOptions: {"show":{"jsonParameters":[true]}}, defaults: {"jsonParameters":false} }),
      propertiesUi: resolveSchema({ parameters, schema: z.object({ propertyValues: z.array(z.object({ key: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }), required: false, displayOptions: {"show":{"jsonParameters":[false]}}, defaults: {"jsonParameters":false} }),
      options: resolveSchema({ parameters, schema: z.object({ fileName: stringOrExpression.optional() }), required: false, displayOptions: {"show":{"download":[true]}}, defaults: {"download":false} }),
    }).optional(),
  });
};
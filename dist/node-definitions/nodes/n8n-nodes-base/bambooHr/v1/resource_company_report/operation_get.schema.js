/**
 * BambooHR Node - Version 1 - Zod Schema
 * Discriminator: resource=companyReport, operation=get
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
      resource: z.literal('companyReport'),
      operation: z.literal('get').default('get'),
      reportId: stringOrExpression,
      format: z.union([z.literal('CSV'), z.literal('JSON'), z.literal('PDF'), z.literal('XLS'), z.literal('XML'), expressionSchema]).optional(),
      output: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"hide":{"format":["JSON"]}}, defaults: {"format":"JSON"} }),
      options: z.object({ fd: booleanOrExpression.optional(), onlyCurrent: booleanOrExpression.optional() }).optional(),
    }).optional(),
  });
};
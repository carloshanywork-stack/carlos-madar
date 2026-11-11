/**
 * AWS ELB Node - Version 1 - Zod Schema
 * Discriminator: resource=loadBalancer, operation=getMany
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
      resource: z.literal('loadBalancer').default('loadBalancer'),
      operation: z.literal('getMany'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      filters: resolveSchema({ parameters, schema: z.object({ names: stringOrExpression.optional() }), required: false, displayOptions: {"show":{"returnAll":[true]}}, defaults: {"returnAll":false} }),
    }).optional(),
  });
};
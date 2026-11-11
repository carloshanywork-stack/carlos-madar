/**
 * Airtable Node - Version 2.1 - Zod Schema
 * Discriminator: resource=base, operation=getMany
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
      resource: z.literal('base'),
      operation: z.literal('getMany').default('getMany'),
      authentication: z.union([z.literal('airtableTokenApi'), z.literal('airtableOAuth2Api'), expressionSchema]).optional(),
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":true} }),
      options: z.object({ permissionLevel: z.array(z.union([z.literal('comment'), z.literal('create'), z.literal('edit'), z.literal('none'), z.literal('read')])).optional() }).optional(),
    }).optional(),
  });
};
/**
 * Bitly Node - Version 1 - Zod Schema
 * Discriminator: resource=link, operation=create
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
      resource: z.literal('link').default('link'),
      operation: z.literal('create').default('create'),
      authentication: z.union([z.literal('accessToken'), z.literal('oAuth2'), expressionSchema]).optional(),
      longUrl: stringOrExpression,
      additionalFields: z.object({ domain: stringOrExpression.optional(), group: stringOrExpression.optional(), tags: z.array(z.string()).optional(), title: stringOrExpression.optional() }).optional(),
      deeplink: z.object({ deeplinkUi: z.array(z.object({ appId: stringOrExpression.optional(), appUriPath: stringOrExpression.optional(), installType: stringOrExpression.optional(), installUrl: stringOrExpression.optional() })).optional() }).optional(),
    }).optional(),
  });
};
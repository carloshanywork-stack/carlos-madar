/**
 * Agile CRM Node - Version 1 - Zod Schema
 * Discriminator: resource=contact, operation=create
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
      resource: z.literal('contact').default('contact'),
      operation: z.literal('create'),
      jsonParameters: booleanOrExpression.optional(),
      additionalFieldsJson: resolveSchema({ parameters, schema: z.union([iDataObjectSchema, z.string()]), required: false, displayOptions: {"show":{"jsonParameters":[true]}}, defaults: {"jsonParameters":false} }),
      additionalFields: resolveSchema({ parameters, schema: z.object({ addressOptions: z.object({ addressProperties: z.array(z.object({ subtype: z.union([z.literal('home'), z.literal('postal'), z.literal('office'), expressionSchema]).optional(), address: stringOrExpression.optional() })).optional() }).optional(), company: stringOrExpression.optional(), emailOptions: z.object({ emailProperties: z.array(z.object({ subtype: z.union([z.literal('work'), z.literal('personal'), expressionSchema]).optional(), email: stringOrExpression.optional() })).optional() }).optional(), firstName: stringOrExpression.optional(), lastName: stringOrExpression.optional(), leadScore: numberOrExpression.optional(), starValue: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), expressionSchema]).optional(), phoneOptions: z.object({ phoneProperties: z.array(z.object({ subtype: z.union([z.literal('home'), z.literal('homeFax'), z.literal('main'), z.literal('mobile'), z.literal('other'), z.literal('work'), z.literal('workFax'), expressionSchema]).optional(), number: stringOrExpression.optional() })).optional() }).optional(), tags: z.array(stringOrExpression).optional(), title: stringOrExpression.optional(), websiteOptions: z.object({ websiteProperties: z.array(z.object({ subtype: z.union([z.literal('facebook'), z.literal('feed'), z.literal('flickr'), z.literal('github'), z.literal('googlePlus'), z.literal('linkedin'), z.literal('skype'), z.literal('twitter'), z.literal('url'), z.literal('xing'), z.literal('youtube'), expressionSchema]).optional(), url: stringOrExpression.optional() })).optional() }).optional(), customProperties: z.object({ customProperty: z.array(z.object({ name: stringOrExpression.optional(), subtype: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional() }), required: false, displayOptions: {"show":{"jsonParameters":[false]}}, defaults: {"jsonParameters":false} }),
    }).optional(),
  });
};
/**
 * AWS SNS Node - Version 1 - Zod Validation Schemas
 *
 * These schemas validate node configuration at runtime.
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema, resolveSchema, resolveOneOfSchemas }) {

  // Parameters schema
  const parametersSchema = z.object({
    authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
    operation: z.union([z.literal('create'), z.literal('delete'), z.literal('publish')]).optional(),
    name: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"operation":["create"]}}, defaults: {"operation":"publish"} }),
    options: resolveSchema({ parameters, schema: z.object({ displayName: stringOrExpression.optional(), fifoTopic: booleanOrExpression.optional() }), required: false, displayOptions: {"show":{"operation":["create"]}}, defaults: {"operation":"publish"} }),
    topic: resolveSchema({ parameters, schema: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('url'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]), required: false, displayOptions: {"show":{"operation":["publish","delete"]}}, defaults: {"operation":"publish"} }),
    subject: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"operation":["publish"]}}, defaults: {"operation":"publish"} }),
    message: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"operation":["publish"]}}, defaults: {"operation":"publish"} }),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
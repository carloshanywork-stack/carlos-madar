/**
 * Bitbucket Trigger Node - Version 1 - Zod Validation Schemas
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
    authentication: z.union([z.literal('password'), z.literal('accessToken'), expressionSchema]).optional(),
    resource: z.union([z.literal('repository'), z.literal('workspace')]).optional(),
    workspace: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"resource":["workspace","repository"]}}, defaults: {"resource":"workspace"} }),
    events: resolveOneOfSchemas({ parameters, variants: [{ schema: z.array(z.string()), required: true, displayOptions: {"show":{"resource":["workspace"]}}, defaults: {"resource":"workspace"} }, { schema: z.array(z.string()), required: true, displayOptions: {"show":{"resource":["repository"]}}, defaults: {"resource":"workspace"} }] }),
    repository: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"resource":["repository"]}}, defaults: {"resource":"workspace"} }),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
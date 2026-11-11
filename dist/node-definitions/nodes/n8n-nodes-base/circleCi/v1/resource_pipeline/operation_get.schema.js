/**
 * CircleCI Node - Version 1 - Zod Schema
 * Discriminator: resource=pipeline, operation=get
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
      resource: z.literal('pipeline').default('pipeline'),
      operation: z.literal('get').default('get'),
      vcs: z.union([z.literal('bitbucket'), z.literal('github'), expressionSchema]).optional(),
      projectSlug: stringOrExpression.optional(),
      pipelineNumber: numberOrExpression.optional(),
    }).optional(),
  });
};
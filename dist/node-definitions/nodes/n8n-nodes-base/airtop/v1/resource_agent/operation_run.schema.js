/**
 * Airtop Node - Version 1 - Zod Schema
 * Discriminator: resource=agent, operation=run
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
      resource: z.literal('agent'),
      operation: z.literal('run').default('run'),
      agentId: z.union([z.object({ __rl: z.literal(true), mode: z.union([z.literal('list'), z.literal('id')]), value: z.union([z.string(), z.number()]), cachedResultName: z.string().optional(), cachedResultUrl: z.string().optional() }), expressionSchema]).optional(),
      agentParameters: resolveSchema({ parameters, schema: resourceMapperValueSchema, required: false, displayOptions: {"hide":{"agentId":[""]}}, defaults: {"agentId":{"mode":"list","value":""}} }),
      profileName: stringOrExpression.optional(),
      awaitExecution: booleanOrExpression.optional(),
      timeout: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"awaitExecution":[true]}}, defaults: {"awaitExecution":true} }),
    }).optional(),
  });
};
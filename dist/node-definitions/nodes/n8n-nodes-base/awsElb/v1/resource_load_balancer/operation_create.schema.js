/**
 * AWS ELB Node - Version 1 - Zod Schema
 * Discriminator: resource=loadBalancer, operation=create
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
      resource: z.literal('loadBalancer').default('loadBalancer'),
      operation: z.literal('create').default('create'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      ipAddressType: z.union([z.literal('ipv4'), z.literal('dualstack'), expressionSchema]).optional(),
      name: stringOrExpression,
      schema: z.union([z.literal('internal'), z.literal('internet-facing'), expressionSchema]).optional(),
      type: z.union([z.literal('application'), z.literal('network'), expressionSchema]).optional(),
      subnets: z.array(z.string()),
      additionalFields: z.object({ securityGroups: z.array(z.string()).optional(), tagsUi: z.object({ tagValues: z.array(z.object({ key: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional() }).optional(),
    }).optional(),
  });
};
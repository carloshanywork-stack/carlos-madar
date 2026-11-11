/**
 * AMQP Sender Node - Version 1 - Zod Validation Schemas
 *
 * These schemas validate node configuration at runtime.
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema }) {

  // Parameters schema
  const parametersSchema = z.object({
    sink: stringOrExpression.optional(),
    headerParametersJson: z.union([iDataObjectSchema, z.string()]).optional(),
    options: z.object({ containerId: stringOrExpression.optional(), dataAsObject: booleanOrExpression.optional(), reconnect: booleanOrExpression.optional(), reconnectLimit: numberOrExpression.optional(), sendOnlyProperty: stringOrExpression.optional() }).optional(),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
/**
 * AMQP Trigger Node - Version 1 - Zod Validation Schemas
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
    clientname: stringOrExpression.optional(),
    subscription: stringOrExpression.optional(),
    options: z.object({ containerId: stringOrExpression.optional(), jsonConvertByteArrayToString: booleanOrExpression.optional(), jsonParseBody: booleanOrExpression.optional(), pullMessagesNumber: numberOrExpression.optional(), onlyBody: booleanOrExpression.optional(), parallelProcessing: booleanOrExpression.optional(), reconnect: booleanOrExpression.optional(), reconnectLimit: numberOrExpression.optional(), sleepTime: numberOrExpression.optional() }).optional(),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
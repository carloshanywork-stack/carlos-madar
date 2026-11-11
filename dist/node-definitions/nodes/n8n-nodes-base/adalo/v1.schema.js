/**
 * Adalo Node - Version 1 - Zod Validation Schemas
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
    resource: z.union([z.literal('collection')]).optional(),
    operation: z.union([z.literal('create'), z.literal('delete'), z.literal('get'), z.literal('getAll'), z.literal('update')]).optional(),
    collectionId: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"resource":["collection"]}}, defaults: {"resource":"collection"} }),
    rowId: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"operation":["get","delete","update"],"resource":["collection"]}}, defaults: {"operation":"getAll","resource":"collection"} }),
    dataToSend: resolveSchema({ parameters, schema: z.union([z.literal('autoMapInputData'), z.literal('defineBelow'), expressionSchema]), required: false, displayOptions: {"show":{"operation":["create","update"],"resource":["collection"]}}, defaults: {"operation":"getAll","resource":"collection"} }),
    inputsToIgnore: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"operation":["create","update"],"dataToSend":["autoMapInputData"],"resource":["collection"]}}, defaults: {"operation":"getAll","dataToSend":"defineBelow","resource":"collection"} }),
    fieldsUi: resolveSchema({ parameters, schema: z.object({ fieldValues: z.array(z.object({ fieldId: stringOrExpression.optional(), fieldValue: stringOrExpression.optional() })).optional() }), required: false, displayOptions: {"show":{"operation":["create","update"],"dataToSend":["defineBelow"],"resource":["collection"]}}, defaults: {"operation":"getAll","dataToSend":"defineBelow","resource":"collection"} }),
    returnAll: resolveSchema({ parameters, schema: booleanOrExpression, required: false, displayOptions: {"show":{"operation":["getAll"],"resource":["collection"]}}, defaults: {"operation":"getAll","resource":"collection"} }),
    limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"operation":["getAll"],"resource":["collection"],"returnAll":[false]}}, defaults: {"operation":"getAll","resource":"collection","returnAll":false} }),
    requestOptions: z.object({ batching: z.object({ batch: z.object({ batchSize: numberOrExpression.optional(), batchInterval: numberOrExpression.optional() }).optional() }).optional(), allowUnauthorizedCerts: z.boolean().optional(), proxy: stringOrExpression.optional(), timeout: numberOrExpression.optional() }).optional(),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
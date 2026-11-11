/**
 * Aggregate Node - Version 1 - Zod Validation Schemas
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
    aggregate: z.union([z.literal('aggregateIndividualFields'), z.literal('aggregateAllItemData'), expressionSchema]).optional(),
    fieldsToAggregate: resolveSchema({ parameters, schema: z.object({ fieldToAggregate: z.array(z.object({ fieldToAggregate: stringOrExpression.optional(), renameField: booleanOrExpression.optional(), outputFieldName: stringOrExpression.optional() })).optional() }), required: false, displayOptions: {"show":{"aggregate":["aggregateIndividualFields"]}}, defaults: {"aggregate":"aggregateIndividualFields"} }),
    destinationFieldName: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"aggregate":["aggregateAllItemData"]}}, defaults: {"aggregate":"aggregateIndividualFields"} }),
    include: resolveSchema({ parameters, schema: z.union([z.literal('allFields'), z.literal('specifiedFields'), z.literal('allFieldsExcept'), expressionSchema]), required: false, displayOptions: {"show":{"aggregate":["aggregateAllItemData"]}}, defaults: {"aggregate":"aggregateIndividualFields"} }),
    fieldsToExclude: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"aggregate":["aggregateAllItemData"],"include":["allFieldsExcept"]}}, defaults: {"aggregate":"aggregateIndividualFields","include":"allFields"} }),
    fieldsToInclude: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"show":{"aggregate":["aggregateAllItemData"],"include":["specifiedFields"]}}, defaults: {"aggregate":"aggregateIndividualFields","include":"allFields"} }),
    options: z.object({ disableDotNotation: booleanOrExpression.optional(), mergeLists: booleanOrExpression.optional(), includeBinaries: booleanOrExpression.optional(), keepOnlyUnique: booleanOrExpression.optional(), keepMissing: booleanOrExpression.optional() }).optional(),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
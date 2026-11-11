/**
 * Affinity Trigger Node - Version 1 - Zod Validation Schemas
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
    events: z.array(z.union([z.literal('field_value.created'), z.literal('field_value.deleted'), z.literal('field_value.updated'), z.literal('field.created'), z.literal('field.deleted'), z.literal('field.updated'), z.literal('file.created'), z.literal('file.deleted'), z.literal('list_entry.created'), z.literal('list_entry.deleted'), z.literal('list.created'), z.literal('list.deleted'), z.literal('list.updated'), z.literal('note.created'), z.literal('note.deleted'), z.literal('note.updated'), z.literal('opportunity.created'), z.literal('opportunity.deleted'), z.literal('opportunity.updated'), z.literal('organization.created'), z.literal('organization.deleted'), z.literal('organization.updated'), z.literal('person.created'), z.literal('person.deleted'), z.literal('person.updated')])),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
/**
 * Airtable - Base Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getGetManySchema = require('./operation_get_many.schema');
const getGetSchemaSchema = require('./operation_get_schema.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'getMany' } : parameters;
  return z.union([
    getGetManySchema({ ...helpers, parameters: effectiveParams }),
    getGetSchemaSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
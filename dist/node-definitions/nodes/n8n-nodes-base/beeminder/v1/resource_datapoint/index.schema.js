/**
 * Beeminder - Datapoint Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getCreateSchema = require('./operation_create.schema');
const getCreateAllSchema = require('./operation_create_all.schema');
const getDeleteSchema = require('./operation_delete.schema');
const getGetSchema = require('./operation_get.schema');
const getGetAllSchema = require('./operation_get_all.schema');
const getUpdateSchema = require('./operation_update.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'create' } : parameters;
  return z.union([
    getCreateSchema({ ...helpers, parameters: effectiveParams }),
    getCreateAllSchema({ ...helpers, parameters: effectiveParams }),
    getDeleteSchema({ ...helpers, parameters: effectiveParams }),
    getGetSchema({ ...helpers, parameters: effectiveParams }),
    getGetAllSchema({ ...helpers, parameters: effectiveParams }),
    getUpdateSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
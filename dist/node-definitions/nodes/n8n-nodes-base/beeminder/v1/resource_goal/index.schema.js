/**
 * Beeminder - Goal Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getCancelStepDownSchema = require('./operation_cancel_step_down.schema');
const getCreateSchema = require('./operation_create.schema');
const getGetSchema = require('./operation_get.schema');
const getGetAllSchema = require('./operation_get_all.schema');
const getGetArchivedSchema = require('./operation_get_archived.schema');
const getRefreshSchema = require('./operation_refresh.schema');
const getShortCircuitSchema = require('./operation_short_circuit.schema');
const getStepDownSchema = require('./operation_step_down.schema');
const getUncleSchema = require('./operation_uncle.schema');
const getUpdateSchema = require('./operation_update.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'get' } : parameters;
  return z.union([
    getCancelStepDownSchema({ ...helpers, parameters: effectiveParams }),
    getCreateSchema({ ...helpers, parameters: effectiveParams }),
    getGetSchema({ ...helpers, parameters: effectiveParams }),
    getGetAllSchema({ ...helpers, parameters: effectiveParams }),
    getGetArchivedSchema({ ...helpers, parameters: effectiveParams }),
    getRefreshSchema({ ...helpers, parameters: effectiveParams }),
    getShortCircuitSchema({ ...helpers, parameters: effectiveParams }),
    getStepDownSchema({ ...helpers, parameters: effectiveParams }),
    getUncleSchema({ ...helpers, parameters: effectiveParams }),
    getUpdateSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
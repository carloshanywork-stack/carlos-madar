/**
 * Coda - View Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getDeleteViewRowSchema = require('./operation_delete_view_row.schema');
const getGetSchema = require('./operation_get.schema');
const getGetAllSchema = require('./operation_get_all.schema');
const getGetAllViewColumnsSchema = require('./operation_get_all_view_columns.schema');
const getGetAllViewRowsSchema = require('./operation_get_all_view_rows.schema');
const getPushViewButtonSchema = require('./operation_push_view_button.schema');
const getUpdateViewRowSchema = require('./operation_update_view_row.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'get' } : parameters;
  return z.union([
    getDeleteViewRowSchema({ ...helpers, parameters: effectiveParams }),
    getGetSchema({ ...helpers, parameters: effectiveParams }),
    getGetAllSchema({ ...helpers, parameters: effectiveParams }),
    getGetAllViewColumnsSchema({ ...helpers, parameters: effectiveParams }),
    getGetAllViewRowsSchema({ ...helpers, parameters: effectiveParams }),
    getPushViewButtonSchema({ ...helpers, parameters: effectiveParams }),
    getUpdateViewRowSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
/**
 * Coda - Table Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getCreateRowSchema = require('./operation_create_row.schema');
const getDeleteRowSchema = require('./operation_delete_row.schema');
const getGetAllColumnsSchema = require('./operation_get_all_columns.schema');
const getGetAllRowsSchema = require('./operation_get_all_rows.schema');
const getGetColumnSchema = require('./operation_get_column.schema');
const getGetRowSchema = require('./operation_get_row.schema');
const getPushButtonSchema = require('./operation_push_button.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'createRow' } : parameters;
  return z.union([
    getCreateRowSchema({ ...helpers, parameters: effectiveParams }),
    getDeleteRowSchema({ ...helpers, parameters: effectiveParams }),
    getGetAllColumnsSchema({ ...helpers, parameters: effectiveParams }),
    getGetAllRowsSchema({ ...helpers, parameters: effectiveParams }),
    getGetColumnSchema({ ...helpers, parameters: effectiveParams }),
    getGetRowSchema({ ...helpers, parameters: effectiveParams }),
    getPushButtonSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
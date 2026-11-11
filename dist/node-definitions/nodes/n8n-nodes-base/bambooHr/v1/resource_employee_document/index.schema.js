/**
 * BambooHR - EmployeeDocument Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getDeleteSchema = require('./operation_delete.schema');
const getDownloadSchema = require('./operation_download.schema');
const getGetAllSchema = require('./operation_get_all.schema');
const getUpdateSchema = require('./operation_update.schema');
const getUploadSchema = require('./operation_upload.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'delete' } : parameters;
  return z.union([
    getDeleteSchema({ ...helpers, parameters: effectiveParams }),
    getDownloadSchema({ ...helpers, parameters: effectiveParams }),
    getGetAllSchema({ ...helpers, parameters: effectiveParams }),
    getUpdateSchema({ ...helpers, parameters: effectiveParams }),
    getUploadSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
/**
 * Airtop - Session Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getCreateSchema = require('./operation_create.schema');
const getSaveSchema = require('./operation_save.schema');
const getTerminateSchema = require('./operation_terminate.schema');
const getWaitForDownloadSchema = require('./operation_wait_for_download.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'create' } : parameters;
  return z.union([
    getCreateSchema({ ...helpers, parameters: effectiveParams }),
    getSaveSchema({ ...helpers, parameters: effectiveParams }),
    getTerminateSchema({ ...helpers, parameters: effectiveParams }),
    getWaitForDownloadSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
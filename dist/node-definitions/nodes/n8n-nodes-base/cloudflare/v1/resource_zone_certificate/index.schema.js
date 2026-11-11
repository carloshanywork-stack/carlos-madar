/**
 * Cloudflare - ZoneCertificate Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getDeleteSchema = require('./operation_delete.schema');
const getGetSchema = require('./operation_get.schema');
const getGetManySchema = require('./operation_get_many.schema');
const getUploadSchema = require('./operation_upload.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'upload' } : parameters;
  return z.union([
    getDeleteSchema({ ...helpers, parameters: effectiveParams }),
    getGetSchema({ ...helpers, parameters: effectiveParams }),
    getGetManySchema({ ...helpers, parameters: effectiveParams }),
    getUploadSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
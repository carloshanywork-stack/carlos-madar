/**
 * Box Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getFileSchema = require('./resource_file/index.schema');
const getFolderSchema = require('./resource_folder/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'file' } : parameters;
  return z.union([
    getFileSchema({ ...helpers, parameters: effectiveParams }),
    getFolderSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
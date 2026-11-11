/**
 * APITemplate.io Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getAccountSchema = require('./resource_account/index.schema');
const getImageSchema = require('./resource_image/index.schema');
const getPdfSchema = require('./resource_pdf/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'image' } : parameters;
  return z.union([
    getAccountSchema({ ...helpers, parameters: effectiveParams }),
    getImageSchema({ ...helpers, parameters: effectiveParams }),
    getPdfSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
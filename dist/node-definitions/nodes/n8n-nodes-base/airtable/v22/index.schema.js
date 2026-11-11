/**
 * Airtable Node - Version 2.2 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getBaseSchema = require('./resource_base/index.schema');
const getRecordSchema = require('./resource_record/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'record' } : parameters;
  return z.union([
    getBaseSchema({ ...helpers, parameters: effectiveParams }),
    getRecordSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
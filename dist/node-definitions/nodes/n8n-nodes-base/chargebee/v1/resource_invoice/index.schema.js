/**
 * Chargebee - Invoice Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getListSchema = require('./operation_list.schema');
const getPdfUrlSchema = require('./operation_pdf_url.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'list' } : parameters;
  return z.union([
    getListSchema({ ...helpers, parameters: effectiveParams }),
    getPdfUrlSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
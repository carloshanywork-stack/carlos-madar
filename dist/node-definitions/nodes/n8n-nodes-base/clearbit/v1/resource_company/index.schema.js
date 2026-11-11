/**
 * Clearbit - Company Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getAutocompleteSchema = require('./operation_autocomplete.schema');
const getEnrichSchema = require('./operation_enrich.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'enrich' } : parameters;
  return z.union([
    getAutocompleteSchema({ ...helpers, parameters: effectiveParams }),
    getEnrichSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
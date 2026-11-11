/**
 * Asana - TaskProject Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getAddSchema = require('./operation_add.schema');
const getRemoveSchema = require('./operation_remove.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'add' } : parameters;
  return z.union([
    getAddSchema({ ...helpers, parameters: effectiveParams }),
    getRemoveSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
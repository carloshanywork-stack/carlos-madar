/**
 * Coda Node - Version 1.1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getControlSchema = require('./resource_control/index.schema');
const getFormulaSchema = require('./resource_formula/index.schema');
const getTableSchema = require('./resource_table/index.schema');
const getViewSchema = require('./resource_view/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'table' } : parameters;
  return z.union([
    getControlSchema({ ...helpers, parameters: effectiveParams }),
    getFormulaSchema({ ...helpers, parameters: effectiveParams }),
    getTableSchema({ ...helpers, parameters: effectiveParams }),
    getViewSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
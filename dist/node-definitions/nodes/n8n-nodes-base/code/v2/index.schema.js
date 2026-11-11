/**
 * Code Node - Version 2 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getRunOnceForAllItemsSchema = require('./mode_run_once_for_all_items.schema');
const getRunOnceForEachItemSchema = require('./mode_run_once_for_each_item.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.mode === undefined ? { ...parameters, mode: 'runOnceForAllItems' } : parameters;
  return z.union([
    getRunOnceForAllItemsSchema({ ...helpers, parameters: effectiveParams }),
    getRunOnceForEachItemSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
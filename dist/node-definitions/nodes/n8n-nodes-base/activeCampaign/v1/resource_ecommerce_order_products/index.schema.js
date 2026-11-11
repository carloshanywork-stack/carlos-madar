/**
 * ActiveCampaign - EcommerceOrderProducts Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getGetAllSchema = require('./operation_get_all.schema');
const getGetByOrderIdSchema = require('./operation_get_by_order_id.schema');
const getGetByProductIdSchema = require('./operation_get_by_product_id.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'getAll' } : parameters;
  return z.union([
    getGetAllSchema({ ...helpers, parameters: effectiveParams }),
    getGetByOrderIdSchema({ ...helpers, parameters: effectiveParams }),
    getGetByProductIdSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
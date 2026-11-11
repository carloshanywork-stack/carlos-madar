/**
 * Beeminder Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getChargeSchema = require('./resource_charge/index.schema');
const getDatapointSchema = require('./resource_datapoint/index.schema');
const getGoalSchema = require('./resource_goal/index.schema');
const getUserSchema = require('./resource_user/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'datapoint' } : parameters;
  return z.union([
    getChargeSchema({ ...helpers, parameters: effectiveParams }),
    getDatapointSchema({ ...helpers, parameters: effectiveParams }),
    getGoalSchema({ ...helpers, parameters: effectiveParams }),
    getUserSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
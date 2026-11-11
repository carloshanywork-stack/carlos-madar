/**
 * Azure Cosmos DB Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getContainerSchema = require('./resource_container/index.schema');
const getItemSchema = require('./resource_item/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'container' } : parameters;
  return z.union([
    getContainerSchema({ ...helpers, parameters: effectiveParams }),
    getItemSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
/**
 * Airtop Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getAgentSchema = require('./resource_agent/index.schema');
const getExtractionSchema = require('./resource_extraction/index.schema');
const getFileSchema = require('./resource_file/index.schema');
const getInteractionSchema = require('./resource_interaction/index.schema');
const getSessionSchema = require('./resource_session/index.schema');
const getWindowSchema = require('./resource_window/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'session' } : parameters;
  return z.union([
    getAgentSchema({ ...helpers, parameters: effectiveParams }),
    getExtractionSchema({ ...helpers, parameters: effectiveParams }),
    getFileSchema({ ...helpers, parameters: effectiveParams }),
    getInteractionSchema({ ...helpers, parameters: effectiveParams }),
    getSessionSchema({ ...helpers, parameters: effectiveParams }),
    getWindowSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
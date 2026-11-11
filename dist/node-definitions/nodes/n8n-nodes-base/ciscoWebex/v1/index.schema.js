/**
 * Webex by Cisco Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getMeetingSchema = require('./resource_meeting/index.schema');
const getMessageSchema = require('./resource_message/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'message' } : parameters;
  return z.union([
    getMeetingSchema({ ...helpers, parameters: effectiveParams }),
    getMessageSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
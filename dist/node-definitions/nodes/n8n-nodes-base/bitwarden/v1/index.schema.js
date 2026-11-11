/**
 * Bitwarden Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getCollectionSchema = require('./resource_collection/index.schema');
const getEventSchema = require('./resource_event/index.schema');
const getGroupSchema = require('./resource_group/index.schema');
const getMemberSchema = require('./resource_member/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'collection' } : parameters;
  return z.union([
    getCollectionSchema({ ...helpers, parameters: effectiveParams }),
    getEventSchema({ ...helpers, parameters: effectiveParams }),
    getGroupSchema({ ...helpers, parameters: effectiveParams }),
    getMemberSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
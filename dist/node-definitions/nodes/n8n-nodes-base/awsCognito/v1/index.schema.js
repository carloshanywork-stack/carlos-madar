/**
 * AWS Cognito Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getGroupSchema = require('./resource_group/index.schema');
const getUserSchema = require('./resource_user/index.schema');
const getUserPoolSchema = require('./resource_user_pool/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'user' } : parameters;
  return z.union([
    getGroupSchema({ ...helpers, parameters: effectiveParams }),
    getUserSchema({ ...helpers, parameters: effectiveParams }),
    getUserPoolSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
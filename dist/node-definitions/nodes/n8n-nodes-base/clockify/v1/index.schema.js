/**
 * Clockify Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getClientSchema = require('./resource_client/index.schema');
const getProjectSchema = require('./resource_project/index.schema');
const getTagSchema = require('./resource_tag/index.schema');
const getTaskSchema = require('./resource_task/index.schema');
const getTimeEntrySchema = require('./resource_time_entry/index.schema');
const getUserSchema = require('./resource_user/index.schema');
const getWorkspaceSchema = require('./resource_workspace/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'project' } : parameters;
  return z.union([
    getClientSchema({ ...helpers, parameters: effectiveParams }),
    getProjectSchema({ ...helpers, parameters: effectiveParams }),
    getTagSchema({ ...helpers, parameters: effectiveParams }),
    getTaskSchema({ ...helpers, parameters: effectiveParams }),
    getTimeEntrySchema({ ...helpers, parameters: effectiveParams }),
    getUserSchema({ ...helpers, parameters: effectiveParams }),
    getWorkspaceSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
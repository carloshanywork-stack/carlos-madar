/**
 * Asana Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getProjectSchema = require('./resource_project/index.schema');
const getSubtaskSchema = require('./resource_subtask/index.schema');
const getTaskSchema = require('./resource_task/index.schema');
const getTaskCommentSchema = require('./resource_task_comment/index.schema');
const getTaskProjectSchema = require('./resource_task_project/index.schema');
const getTaskTagSchema = require('./resource_task_tag/index.schema');
const getUserSchema = require('./resource_user/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'task' } : parameters;
  return z.union([
    getProjectSchema({ ...helpers, parameters: effectiveParams }),
    getSubtaskSchema({ ...helpers, parameters: effectiveParams }),
    getTaskSchema({ ...helpers, parameters: effectiveParams }),
    getTaskCommentSchema({ ...helpers, parameters: effectiveParams }),
    getTaskProjectSchema({ ...helpers, parameters: effectiveParams }),
    getTaskTagSchema({ ...helpers, parameters: effectiveParams }),
    getUserSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
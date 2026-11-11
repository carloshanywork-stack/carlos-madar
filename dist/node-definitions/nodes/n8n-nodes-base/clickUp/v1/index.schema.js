/**
 * ClickUp Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getChecklistSchema = require('./resource_checklist/index.schema');
const getChecklistItemSchema = require('./resource_checklist_item/index.schema');
const getCommentSchema = require('./resource_comment/index.schema');
const getFolderSchema = require('./resource_folder/index.schema');
const getGoalSchema = require('./resource_goal/index.schema');
const getGoalKeyResultSchema = require('./resource_goal_key_result/index.schema');
const getListSchema = require('./resource_list/index.schema');
const getSpaceTagSchema = require('./resource_space_tag/index.schema');
const getTaskSchema = require('./resource_task/index.schema');
const getTaskDependencySchema = require('./resource_task_dependency/index.schema');
const getTaskListSchema = require('./resource_task_list/index.schema');
const getTaskTagSchema = require('./resource_task_tag/index.schema');
const getTimeEntrySchema = require('./resource_time_entry/index.schema');
const getTimeEntryTagSchema = require('./resource_time_entry_tag/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'task' } : parameters;
  return z.union([
    getChecklistSchema({ ...helpers, parameters: effectiveParams }),
    getChecklistItemSchema({ ...helpers, parameters: effectiveParams }),
    getCommentSchema({ ...helpers, parameters: effectiveParams }),
    getFolderSchema({ ...helpers, parameters: effectiveParams }),
    getGoalSchema({ ...helpers, parameters: effectiveParams }),
    getGoalKeyResultSchema({ ...helpers, parameters: effectiveParams }),
    getListSchema({ ...helpers, parameters: effectiveParams }),
    getSpaceTagSchema({ ...helpers, parameters: effectiveParams }),
    getTaskSchema({ ...helpers, parameters: effectiveParams }),
    getTaskDependencySchema({ ...helpers, parameters: effectiveParams }),
    getTaskListSchema({ ...helpers, parameters: effectiveParams }),
    getTaskTagSchema({ ...helpers, parameters: effectiveParams }),
    getTimeEntrySchema({ ...helpers, parameters: effectiveParams }),
    getTimeEntryTagSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
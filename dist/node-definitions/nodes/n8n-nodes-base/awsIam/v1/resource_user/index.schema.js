/**
 * AWS IAM - User Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getAddToGroupSchema = require('./operation_add_to_group.schema');
const getCreateSchema = require('./operation_create.schema');
const getDeleteSchema = require('./operation_delete.schema');
const getGetSchema = require('./operation_get.schema');
const getGetAllSchema = require('./operation_get_all.schema');
const getRemoveFromGroupSchema = require('./operation_remove_from_group.schema');
const getUpdateSchema = require('./operation_update.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'getAll' } : parameters;
  return z.union([
    getAddToGroupSchema({ ...helpers, parameters: effectiveParams }),
    getCreateSchema({ ...helpers, parameters: effectiveParams }),
    getDeleteSchema({ ...helpers, parameters: effectiveParams }),
    getGetSchema({ ...helpers, parameters: effectiveParams }),
    getGetAllSchema({ ...helpers, parameters: effectiveParams }),
    getRemoveFromGroupSchema({ ...helpers, parameters: effectiveParams }),
    getUpdateSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
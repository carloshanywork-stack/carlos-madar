/**
 * Airtop - Window Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getCloseSchema = require('./operation_close.schema');
const getCreateSchema = require('./operation_create.schema');
const getGetLiveViewSchema = require('./operation_get_live_view.schema');
const getListSchema = require('./operation_list.schema');
const getLoadSchema = require('./operation_load.schema');
const getTakeScreenshotSchema = require('./operation_take_screenshot.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'create' } : parameters;
  return z.union([
    getCloseSchema({ ...helpers, parameters: effectiveParams }),
    getCreateSchema({ ...helpers, parameters: effectiveParams }),
    getGetLiveViewSchema({ ...helpers, parameters: effectiveParams }),
    getListSchema({ ...helpers, parameters: effectiveParams }),
    getLoadSchema({ ...helpers, parameters: effectiveParams }),
    getTakeScreenshotSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
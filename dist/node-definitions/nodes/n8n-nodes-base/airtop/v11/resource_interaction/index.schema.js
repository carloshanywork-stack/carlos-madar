/**
 * Airtop - Interaction Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getClickSchema = require('./operation_click.schema');
const getFillSchema = require('./operation_fill.schema');
const getHoverSchema = require('./operation_hover.schema');
const getScrollSchema = require('./operation_scroll.schema');
const getTypeSchema = require('./operation_type.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'click' } : parameters;
  return z.union([
    getClickSchema({ ...helpers, parameters: effectiveParams }),
    getFillSchema({ ...helpers, parameters: effectiveParams }),
    getHoverSchema({ ...helpers, parameters: effectiveParams }),
    getScrollSchema({ ...helpers, parameters: effectiveParams }),
    getTypeSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
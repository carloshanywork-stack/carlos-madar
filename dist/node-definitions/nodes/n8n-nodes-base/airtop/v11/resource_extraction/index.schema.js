/**
 * Airtop - Extraction Resource - Zod Schema Factory
 * Exports a factory that unions all operation schemas for this resource.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getGetPaginatedSchema = require('./operation_get_paginated.schema');
const getQuerySchema = require('./operation_query.schema');
const getScrapeSchema = require('./operation_scrape.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply operation default if not set
  const effectiveParams = parameters.operation === undefined ? { ...parameters, operation: 'getPaginated' } : parameters;
  return z.union([
    getGetPaginatedSchema({ ...helpers, parameters: effectiveParams }),
    getQuerySchema({ ...helpers, parameters: effectiveParams }),
    getScrapeSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
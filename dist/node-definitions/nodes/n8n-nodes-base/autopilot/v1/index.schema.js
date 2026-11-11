/**
 * Autopilot Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getContactSchema = require('./resource_contact/index.schema');
const getContactJourneySchema = require('./resource_contact_journey/index.schema');
const getContactListSchema = require('./resource_contact_list/index.schema');
const getListSchema = require('./resource_list/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'contact' } : parameters;
  return z.union([
    getContactSchema({ ...helpers, parameters: effectiveParams }),
    getContactJourneySchema({ ...helpers, parameters: effectiveParams }),
    getContactListSchema({ ...helpers, parameters: effectiveParams }),
    getListSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
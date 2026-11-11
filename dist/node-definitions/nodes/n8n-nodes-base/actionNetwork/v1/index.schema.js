/**
 * Action Network Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getAttendanceSchema = require('./resource_attendance/index.schema');
const getEventSchema = require('./resource_event/index.schema');
const getPersonSchema = require('./resource_person/index.schema');
const getPersonTagSchema = require('./resource_person_tag/index.schema');
const getPetitionSchema = require('./resource_petition/index.schema');
const getSignatureSchema = require('./resource_signature/index.schema');
const getTagSchema = require('./resource_tag/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'attendance' } : parameters;
  return z.union([
    getAttendanceSchema({ ...helpers, parameters: effectiveParams }),
    getEventSchema({ ...helpers, parameters: effectiveParams }),
    getPersonSchema({ ...helpers, parameters: effectiveParams }),
    getPersonTagSchema({ ...helpers, parameters: effectiveParams }),
    getPetitionSchema({ ...helpers, parameters: effectiveParams }),
    getSignatureSchema({ ...helpers, parameters: effectiveParams }),
    getTagSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
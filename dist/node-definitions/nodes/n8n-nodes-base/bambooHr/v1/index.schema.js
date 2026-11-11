/**
 * BambooHR Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getCompanyReportSchema = require('./resource_company_report/index.schema');
const getEmployeeSchema = require('./resource_employee/index.schema');
const getEmployeeDocumentSchema = require('./resource_employee_document/index.schema');
const getFileSchema = require('./resource_file/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'employee' } : parameters;
  return z.union([
    getCompanyReportSchema({ ...helpers, parameters: effectiveParams }),
    getEmployeeSchema({ ...helpers, parameters: effectiveParams }),
    getEmployeeDocumentSchema({ ...helpers, parameters: effectiveParams }),
    getFileSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
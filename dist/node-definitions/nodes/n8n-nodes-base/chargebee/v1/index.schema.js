/**
 * Chargebee Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getCustomerSchema = require('./resource_customer/index.schema');
const getInvoiceSchema = require('./resource_invoice/index.schema');
const getSubscriptionSchema = require('./resource_subscription/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'invoice' } : parameters;
  return z.union([
    getCustomerSchema({ ...helpers, parameters: effectiveParams }),
    getInvoiceSchema({ ...helpers, parameters: effectiveParams }),
    getSubscriptionSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
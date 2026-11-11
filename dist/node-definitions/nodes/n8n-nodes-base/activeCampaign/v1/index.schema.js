/**
 * ActiveCampaign Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getAccountSchema = require('./resource_account/index.schema');
const getAccountContactSchema = require('./resource_account_contact/index.schema');
const getConnectionSchema = require('./resource_connection/index.schema');
const getContactSchema = require('./resource_contact/index.schema');
const getContactListSchema = require('./resource_contact_list/index.schema');
const getContactTagSchema = require('./resource_contact_tag/index.schema');
const getDealSchema = require('./resource_deal/index.schema');
const getEcommerceCustomerSchema = require('./resource_ecommerce_customer/index.schema');
const getEcommerceOrderSchema = require('./resource_ecommerce_order/index.schema');
const getEcommerceOrderProductsSchema = require('./resource_ecommerce_order_products/index.schema');
const getListSchema = require('./resource_list/index.schema');
const getTagSchema = require('./resource_tag/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'contact' } : parameters;
  return z.union([
    getAccountSchema({ ...helpers, parameters: effectiveParams }),
    getAccountContactSchema({ ...helpers, parameters: effectiveParams }),
    getConnectionSchema({ ...helpers, parameters: effectiveParams }),
    getContactSchema({ ...helpers, parameters: effectiveParams }),
    getContactListSchema({ ...helpers, parameters: effectiveParams }),
    getContactTagSchema({ ...helpers, parameters: effectiveParams }),
    getDealSchema({ ...helpers, parameters: effectiveParams }),
    getEcommerceCustomerSchema({ ...helpers, parameters: effectiveParams }),
    getEcommerceOrderSchema({ ...helpers, parameters: effectiveParams }),
    getEcommerceOrderProductsSchema({ ...helpers, parameters: effectiveParams }),
    getListSchema({ ...helpers, parameters: effectiveParams }),
    getTagSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
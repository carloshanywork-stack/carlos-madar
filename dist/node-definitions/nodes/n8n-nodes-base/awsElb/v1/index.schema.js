/**
 * AWS ELB Node - Version 1 - Zod Schema Factory
 * Exports a factory that unions all discriminator schemas.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

const getListenerCertificateSchema = require('./resource_listener_certificate/index.schema');
const getLoadBalancerSchema = require('./resource_load_balancer/index.schema');

module.exports = function getSchema(helpers) {
  const { parameters, z } = helpers;
  // Apply discriminator default if not set
  const effectiveParams = parameters.resource === undefined ? { ...parameters, resource: 'loadBalancer' } : parameters;
  return z.union([
    getListenerCertificateSchema({ ...helpers, parameters: effectiveParams }),
    getLoadBalancerSchema({ ...helpers, parameters: effectiveParams }),
  ]);
};
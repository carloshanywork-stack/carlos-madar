/**
 * Netscaler ADC Node - Version 1 - Zod Schema
 * Discriminator: resource=certificate, operation=create
 *
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema, resolveSchema, resolveOneOfSchemas }) {

  return z.object({
    parameters: z.object({
      resource: z.literal('certificate'),
      operation: z.literal('create').default('create'),
      certificateFileName: stringOrExpression,
      certificateFormat: z.union([z.literal('PEM'), z.literal('DER'), expressionSchema]).optional(),
      certificateType: z.union([z.literal('ROOT_CERT'), z.literal('INTM_CERT'), z.literal('SRVR_CERT'), z.literal('CLNT_CERT'), expressionSchema]).optional(),
      certificateRequestFileName: stringOrExpression,
      caCertificateFileName: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"certificateType":["INTM_CERT","SRVR_CERT","CLNT_CERT"]}}, defaults: {"certificateType":"ROOT_CERT"} }),
      caCertificateFileFormat: resolveSchema({ parameters, schema: z.union([z.literal('PEM'), z.literal('DER'), expressionSchema]), required: false, displayOptions: {"show":{"certificateType":["INTM_CERT","SRVR_CERT","CLNT_CERT"]}}, defaults: {"certificateType":"ROOT_CERT"} }),
      caPrivateKeyFileName: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"certificateType":["INTM_CERT","SRVR_CERT","CLNT_CERT"]}}, defaults: {"certificateType":"ROOT_CERT"} }),
      caPrivateKeyFileFormat: resolveSchema({ parameters, schema: z.union([z.literal('PEM'), z.literal('DER'), expressionSchema]), required: false, displayOptions: {"show":{"certificateType":["INTM_CERT","SRVR_CERT","CLNT_CERT"]}}, defaults: {"certificateType":"ROOT_CERT"} }),
      privateKeyFileName: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"certificateType":["ROOT_CERT"]}}, defaults: {"certificateType":"ROOT_CERT"} }),
      caSerialFileNumber: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"certificateType":["INTM_CERT","SRVR_CERT","CLNT_CERT"]}}, defaults: {"certificateType":"ROOT_CERT"} }),
      privateKeyFormat: resolveSchema({ parameters, schema: z.union([z.literal('PEM'), z.literal('DER'), expressionSchema]), required: false, displayOptions: {"show":{"certificateType":["ROOT_CERT"]}}, defaults: {"certificateType":"ROOT_CERT"} }),
      additionalFields: z.object({ pempassphrase: stringOrExpression.optional(), subjectaltname: stringOrExpression.optional(), days: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
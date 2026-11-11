/**
 * AWS SES Node - Version 1 - Zod Schema
 * Discriminator: resource=email, operation=send
 *
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema }) {

  return z.object({
    parameters: z.object({
      resource: z.literal('email').default('email'),
      operation: z.literal('send').default('send'),
      authentication: z.union([z.literal('iam'), z.literal('assumeRole'), expressionSchema]).optional(),
      isBodyHtml: booleanOrExpression.optional(),
      subject: stringOrExpression,
      body: stringOrExpression,
      fromEmail: stringOrExpression,
      toAddresses: z.array(stringOrExpression).optional(),
      additionalFields: z.object({ bccAddresses: z.array(stringOrExpression).optional(), ccAddresses: z.array(stringOrExpression).optional(), configurationSetName: stringOrExpression.optional(), replyToAddresses: z.array(stringOrExpression).optional(), returnPath: stringOrExpression.optional(), returnPathArn: stringOrExpression.optional(), sourceArn: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
/**
 * BambooHR Node - Version 1 - Zod Schema
 * Discriminator: resource=employee, operation=update
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
      resource: z.literal('employee').default('employee'),
      operation: z.literal('update'),
      employeeId: stringOrExpression,
      synced: booleanOrExpression.optional(),
      addasasress: resolveSchema({ parameters, schema: z.object({ value: z.object({ address1: stringOrExpression.optional(), address2: stringOrExpression.optional(), city: stringOrExpression.optional(), state: stringOrExpression.optional(), country: stringOrExpression.optional() }).optional() }), required: false, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      dateOfBirth: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      department: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      division: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      employeeNumber: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      firstName: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      lastName: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      exempt: resolveSchema({ parameters, schema: z.union([z.literal('exempt'), z.literal('non-exempt'), expressionSchema]), required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      gender: resolveSchema({ parameters, schema: z.union([z.literal('female'), z.literal('male'), expressionSchema]), required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      hireDate: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      location: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      maritalStatus: resolveSchema({ parameters, schema: z.union([z.literal('single'), z.literal('married'), z.literal('domesticPartnership'), expressionSchema]), required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      mobilePhone: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      paidPer: resolveSchema({ parameters, schema: z.union([z.literal('hour'), z.literal('day'), z.literal('week'), z.literal('month'), z.literal('quater'), z.literal('year'), expressionSchema]), required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      payRate: resolveSchema({ parameters, schema: z.object({ value: z.object({ value: stringOrExpression.optional(), currency: stringOrExpression.optional() }).optional() }), required: false, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      payType: resolveSchema({ parameters, schema: z.union([z.literal('commission'), z.literal('contract'), z.literal('daily'), z.literal('exceptionHourly'), z.literal('hourly'), z.literal('monthly'), z.literal('pieceRate'), z.literal('proRata'), z.literal('salary'), z.literal('weekly'), expressionSchema]), required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      preferredName: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      ssn: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"synced":[true]}}, defaults: {"synced":false} }),
      updateFields: z.object({ addasasress: z.object({ value: z.object({ address1: stringOrExpression.optional(), address2: stringOrExpression.optional(), city: stringOrExpression.optional(), state: stringOrExpression.optional(), country: stringOrExpression.optional() }).optional() }).optional(), dateOfBirth: stringOrExpression.optional(), department: stringOrExpression.optional(), division: stringOrExpression.optional(), employeeNumber: stringOrExpression.optional(), firstName: stringOrExpression.optional(), lastName: stringOrExpression.optional(), exempt: z.union([z.literal('exempt'), z.literal('non-exempt'), expressionSchema]).optional(), gender: z.union([z.literal('female'), z.literal('male'), expressionSchema]).optional(), hireDate: stringOrExpression.optional(), location: stringOrExpression.optional(), maritalStatus: z.union([z.literal('single'), z.literal('married'), z.literal('domesticPartnership'), expressionSchema]).optional(), mobilePhone: stringOrExpression.optional(), paidPer: z.union([z.literal('hour'), z.literal('day'), z.literal('week'), z.literal('month'), z.literal('quater'), z.literal('year'), expressionSchema]).optional(), payRate: z.object({ value: z.object({ value: stringOrExpression.optional(), currency: stringOrExpression.optional() }).optional() }).optional(), payType: z.union([z.literal('commission'), z.literal('contract'), z.literal('daily'), z.literal('exceptionHourly'), z.literal('hourly'), z.literal('monthly'), z.literal('pieceRate'), z.literal('proRata'), z.literal('salary'), z.literal('weekly'), expressionSchema]).optional(), preferredName: stringOrExpression.optional(), ssn: stringOrExpression.optional(), workEmail: stringOrExpression.optional(), workPhone: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
/**
 * Chargebee Trigger Node - Version 1 - Zod Validation Schemas
 *
 * These schemas validate node configuration at runtime.
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema }) {

  // Parameters schema
  const parametersSchema = z.object({
    events: z.array(z.union([z.literal('*'), z.literal('card_added'), z.literal('card_deleted'), z.literal('card_expired'), z.literal('card_expiring'), z.literal('card_updated'), z.literal('customer_changed'), z.literal('customer_created'), z.literal('customer_deleted'), z.literal('invoice_created'), z.literal('invoice_deleted'), z.literal('invoice_generated'), z.literal('invoice_updated'), z.literal('payment_failed'), z.literal('payment_initiated'), z.literal('payment_refunded'), z.literal('payment_succeeded'), z.literal('refund_initiated'), z.literal('subscription_activated'), z.literal('subscription_cancellation_scheduled'), z.literal('subscription_cancelled'), z.literal('subscription_cancelling'), z.literal('subscription_changed'), z.literal('subscription_created'), z.literal('subscription_deleted'), z.literal('subscription_reactivated'), z.literal('subscription_renewal_reminder'), z.literal('subscription_renewed'), z.literal('subscription_scheduled_cancellation_removed'), z.literal('subscription_shipping_address_updated'), z.literal('subscription_started'), z.literal('subscription_trial_ending'), z.literal('transaction_created'), z.literal('transaction_deleted'), z.literal('transaction_updated')])),
  });

  // Return combined config schema
  return z.object({
    parameters: parametersSchema.nullable().optional(),
  });
};
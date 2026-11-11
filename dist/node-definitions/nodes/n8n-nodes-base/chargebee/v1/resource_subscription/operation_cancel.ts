/**
 * Chargebee Node - Version 1
 * Discriminator: resource=subscription, operation=cancel
 */


interface Credentials {
  chargebeeApi: CredentialReference;
}

/** Cancel a subscription */
export type ChargebeeV1SubscriptionCancelParams = {
  resource: 'subscription';
  operation: 'cancel';
/**
 * The ID of the subscription to cancel
 */
    subscriptionId: string | Expression<string>;
/**
 * Whether it will not cancel it directly in will instead schedule the cancelation for the end of the term
 * @default false
 */
    endOfTerm?: boolean | Expression<boolean>;
};

export type ChargebeeV1SubscriptionCancelNode = {
  type: 'n8n-nodes-base.chargebee';
  version: 1;
  config: NodeConfig<ChargebeeV1SubscriptionCancelParams> & { credentials?: Credentials };
};
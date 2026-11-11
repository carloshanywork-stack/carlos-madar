/**
 * Chargebee Node - Version 1
 * Discriminator: resource=subscription, operation=delete
 */


interface Credentials {
  chargebeeApi: CredentialReference;
}

/** Delete a subscription */
export type ChargebeeV1SubscriptionDeleteParams = {
  resource: 'subscription';
  operation: 'delete';
/**
 * The ID of the subscription to delete
 */
    subscriptionId: string | Expression<string>;
};

export type ChargebeeV1SubscriptionDeleteNode = {
  type: 'n8n-nodes-base.chargebee';
  version: 1;
  config: NodeConfig<ChargebeeV1SubscriptionDeleteParams> & { credentials?: Credentials };
};
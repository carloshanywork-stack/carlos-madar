/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=ecommerceOrder, operation=delete
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Delete an account */
export type ActiveCampaignV1EcommerceOrderDeleteParams = {
  resource: 'ecommerceOrder';
  operation: 'delete';
/**
 * The ID of the e-commerce order
 * @default 0
 */
    orderId?: number | Expression<number>;
};

export type ActiveCampaignV1EcommerceOrderDeleteNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1EcommerceOrderDeleteParams> & { credentials?: Credentials };
};
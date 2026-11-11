/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=ecommerceOrder, operation=get
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of an account */
export type ActiveCampaignV1EcommerceOrderGetParams = {
  resource: 'ecommerceOrder';
  operation: 'get';
/**
 * The ID of the e-commerce order
 * @default 0
 */
    orderId?: number | Expression<number>;
};

export type ActiveCampaignV1EcommerceOrderGetNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1EcommerceOrderGetParams> & { credentials?: Credentials };
};
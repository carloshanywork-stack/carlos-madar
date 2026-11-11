/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=ecommerceOrderProducts, operation=getByProductId
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of a ordered product */
export type ActiveCampaignV1EcommerceOrderProductsGetByProductIdParams = {
  resource: 'ecommerceOrderProducts';
  operation: 'getByProductId';
/**
 * The ID of the product you'd like returned
 * @default 0
 */
    procuctId?: number | Expression<number>;
};

export type ActiveCampaignV1EcommerceOrderProductsGetByProductIdNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1EcommerceOrderProductsGetByProductIdParams> & { credentials?: Credentials };
};
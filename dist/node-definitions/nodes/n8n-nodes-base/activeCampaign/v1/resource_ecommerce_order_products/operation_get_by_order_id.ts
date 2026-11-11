/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=ecommerceOrderProducts, operation=getByOrderId
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of an order's products */
export type ActiveCampaignV1EcommerceOrderProductsGetByOrderIdParams = {
  resource: 'ecommerceOrderProducts';
  operation: 'getByOrderId';
/**
 * The ID of the order whose products you'd like returned
 * @default 0
 */
    orderId?: number | Expression<number>;
};

export type ActiveCampaignV1EcommerceOrderProductsGetByOrderIdNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1EcommerceOrderProductsGetByOrderIdParams> & { credentials?: Credentials };
};
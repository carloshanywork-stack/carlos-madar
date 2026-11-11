/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=ecommerceCustomer, operation=get
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of an account */
export type ActiveCampaignV1EcommerceCustomerGetParams = {
  resource: 'ecommerceCustomer';
  operation: 'get';
/**
 * ID of the E-commerce customer to get
 * @default 0
 */
    ecommerceCustomerId?: number | Expression<number>;
};

export type ActiveCampaignV1EcommerceCustomerGetNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1EcommerceCustomerGetParams> & { credentials?: Credentials };
};
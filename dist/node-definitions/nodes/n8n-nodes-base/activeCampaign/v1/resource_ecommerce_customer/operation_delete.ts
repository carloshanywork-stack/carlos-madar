/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=ecommerceCustomer, operation=delete
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Delete an account */
export type ActiveCampaignV1EcommerceCustomerDeleteParams = {
  resource: 'ecommerceCustomer';
  operation: 'delete';
/**
 * ID of the E-commerce customer to delete
 * @default 0
 */
    ecommerceCustomerId?: number | Expression<number>;
};

export type ActiveCampaignV1EcommerceCustomerDeleteNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1EcommerceCustomerDeleteParams> & { credentials?: Credentials };
};
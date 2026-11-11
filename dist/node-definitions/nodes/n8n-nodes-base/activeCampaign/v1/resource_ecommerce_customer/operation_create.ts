/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=ecommerceCustomer, operation=create
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Create an account */
export type ActiveCampaignV1EcommerceCustomerCreateParams = {
  resource: 'ecommerceCustomer';
  operation: 'create';
/**
 * The ID of the connection object for the service where the customer originates
 */
    connectionid: string | Expression<string>;
/**
 * The ID of the customer in the external service
 */
    externalid: string | Expression<string>;
/**
 * The email address of the customer
 */
    email: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Whether customer has opt-ed in to marketing communications
     * @default false
     */
    acceptsMarketing?: boolean | Expression<boolean>;
  };
};

export type ActiveCampaignV1EcommerceCustomerCreateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1EcommerceCustomerCreateParams> & { credentials?: Credentials };
};
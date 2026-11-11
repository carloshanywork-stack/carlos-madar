/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=ecommerceCustomer, operation=update
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Update an account */
export type ActiveCampaignV1EcommerceCustomerUpdateParams = {
  resource: 'ecommerceCustomer';
  operation: 'update';
/**
 * ID of the E-commerce customer to update
 * @default 0
 */
    ecommerceCustomerId?: number | Expression<number>;
/**
 * The fields to update
 * @default {}
 */
    updateFields?: {
    /** The ID of the connection object for the service where the customer originates
     */
    connectionid?: string | Expression<string>;
    /** The ID of the customer in the external service
     */
    externalid?: string | Expression<string>;
    /** The email address of the customer
     */
    email?: string | Expression<string>;
    /** Whether customer has opt-ed in to marketing communications
     * @default false
     */
    acceptsMarketing?: boolean | Expression<boolean>;
  };
};

export type ActiveCampaignV1EcommerceCustomerUpdateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1EcommerceCustomerUpdateParams> & { credentials?: Credentials };
};
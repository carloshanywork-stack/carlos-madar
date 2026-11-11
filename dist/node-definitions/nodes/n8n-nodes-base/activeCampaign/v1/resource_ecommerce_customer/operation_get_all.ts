/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=ecommerceCustomer, operation=getAll
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of many accounts */
export type ActiveCampaignV1EcommerceCustomerGetAllParams = {
  resource: 'ecommerceCustomer';
  operation: 'getAll';
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
};

export type ActiveCampaignV1EcommerceCustomerGetAllNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1EcommerceCustomerGetAllParams> & { credentials?: Credentials };
};
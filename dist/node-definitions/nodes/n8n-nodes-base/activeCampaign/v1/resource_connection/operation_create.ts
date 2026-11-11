/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=connection, operation=create
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Create an account */
export type ActiveCampaignV1ConnectionCreateParams = {
  resource: 'connection';
  operation: 'create';
/**
 * The name of the service
 */
    service: string | Expression<string>;
/**
 * The ID of the account in the external service
 */
    externalid: string | Expression<string>;
/**
 * The name associated with the account in the external service. Often this will be a company name (e.g., "My Toystore, Inc.").
 */
    name: string | Expression<string>;
/**
 * The URL to a logo image for the external service
 */
    logoUrl: string | Expression<string>;
/**
 * The URL to a page where the integration with the external service can be managed in the third-party's website
 */
    linkUrl: string | Expression<string>;
};

export type ActiveCampaignV1ConnectionCreateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ConnectionCreateParams> & { credentials?: Credentials };
};
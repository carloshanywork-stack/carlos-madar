/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=connection, operation=update
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Update an account */
export type ActiveCampaignV1ConnectionUpdateParams = {
  resource: 'connection';
  operation: 'update';
/**
 * ID of the connection to update
 * @default 0
 */
    connectionId?: number | Expression<number>;
/**
 * The fields to update
 * @default {}
 */
    updateFields?: {
    /** The name of the service
     */
    service?: string | Expression<string>;
    /** The ID of the account in the external service
     */
    externalid?: string | Expression<string>;
    /** The name associated with the account in the external service. Often this will be a company name (e.g., "My Toystore, Inc.").
     */
    name?: string | Expression<string>;
    /** The URL to a logo image for the external service
     */
    logoUrl?: string | Expression<string>;
    /** The URL to a page where the integration with the external service can be managed in the third-party's website
     */
    linkUrl?: string | Expression<string>;
    /** The status of the connection (0 = error; 1 = connected)
     * @default 1
     */
    status?: number | Expression<number>;
    /** The status of a sync triggered on the connection (0 = sync stopped; 1 = sync running)
     * @default 1
     */
    syncStatus?: number | Expression<number>;
  };
};

export type ActiveCampaignV1ConnectionUpdateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ConnectionUpdateParams> & { credentials?: Credentials };
};
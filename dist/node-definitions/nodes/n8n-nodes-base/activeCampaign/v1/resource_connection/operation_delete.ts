/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=connection, operation=delete
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Delete an account */
export type ActiveCampaignV1ConnectionDeleteParams = {
  resource: 'connection';
  operation: 'delete';
/**
 * ID of the connection to delete
 * @default 0
 */
    connectionId?: number | Expression<number>;
};

export type ActiveCampaignV1ConnectionDeleteNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ConnectionDeleteParams> & { credentials?: Credentials };
};
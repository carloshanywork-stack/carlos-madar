/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=connection, operation=get
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of an account */
export type ActiveCampaignV1ConnectionGetParams = {
  resource: 'connection';
  operation: 'get';
/**
 * ID of the connection to get
 * @default 0
 */
    connectionId?: number | Expression<number>;
};

export type ActiveCampaignV1ConnectionGetNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ConnectionGetParams> & { credentials?: Credentials };
};
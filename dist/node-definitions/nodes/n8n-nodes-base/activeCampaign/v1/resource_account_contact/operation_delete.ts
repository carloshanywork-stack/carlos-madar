/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=accountContact, operation=delete
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Delete an account */
export type ActiveCampaignV1AccountContactDeleteParams = {
  resource: 'accountContact';
  operation: 'delete';
/**
 * ID of the account contact to delete
 * @default 0
 */
    accountContactId?: number | Expression<number>;
};

export type ActiveCampaignV1AccountContactDeleteNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1AccountContactDeleteParams> & { credentials?: Credentials };
};
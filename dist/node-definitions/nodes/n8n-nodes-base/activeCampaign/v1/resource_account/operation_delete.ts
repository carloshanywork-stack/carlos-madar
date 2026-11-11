/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=account, operation=delete
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Delete an account */
export type ActiveCampaignV1AccountDeleteParams = {
  resource: 'account';
  operation: 'delete';
/**
 * ID of the account to delete
 * @default 0
 */
    accountId?: number | Expression<number>;
};

export type ActiveCampaignV1AccountDeleteNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1AccountDeleteParams> & { credentials?: Credentials };
};
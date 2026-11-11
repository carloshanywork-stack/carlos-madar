/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=deal, operation=delete
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Delete an account */
export type ActiveCampaignV1DealDeleteParams = {
  resource: 'deal';
  operation: 'delete';
/**
 * The ID of the deal to delete
 * @default 0
 */
    dealId?: number | Expression<number>;
};

export type ActiveCampaignV1DealDeleteNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1DealDeleteParams> & { credentials?: Credentials };
};
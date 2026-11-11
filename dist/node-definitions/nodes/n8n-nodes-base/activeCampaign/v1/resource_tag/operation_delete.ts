/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=tag, operation=delete
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Delete an account */
export type ActiveCampaignV1TagDeleteParams = {
  resource: 'tag';
  operation: 'delete';
/**
 * ID of the tag to delete
 * @default 0
 */
    tagId?: number | Expression<number>;
};

export type ActiveCampaignV1TagDeleteNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1TagDeleteParams> & { credentials?: Credentials };
};
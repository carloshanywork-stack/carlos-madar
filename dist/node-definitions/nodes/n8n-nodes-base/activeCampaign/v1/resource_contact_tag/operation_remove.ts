/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=contactTag, operation=remove
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Remove contact from a list */
export type ActiveCampaignV1ContactTagRemoveParams = {
  resource: 'contactTag';
  operation: 'remove';
/**
 * ID of the contact tag to delete
 * @default 0
 */
    contactTagId?: number | Expression<number>;
};

export type ActiveCampaignV1ContactTagRemoveNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ContactTagRemoveParams> & { credentials?: Credentials };
};
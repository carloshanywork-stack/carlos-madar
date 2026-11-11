/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=contactList, operation=remove
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Remove contact from a list */
export type ActiveCampaignV1ContactListRemoveParams = {
  resource: 'contactList';
  operation: 'remove';
/**
 * List ID
 */
    listId?: number | Expression<number>;
/**
 * Contact ID
 */
    contactId?: number | Expression<number>;
};

export type ActiveCampaignV1ContactListRemoveNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ContactListRemoveParams> & { credentials?: Credentials };
};
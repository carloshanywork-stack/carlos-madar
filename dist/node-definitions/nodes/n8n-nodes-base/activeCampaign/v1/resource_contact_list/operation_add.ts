/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=contactList, operation=add
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Add contact to a list */
export type ActiveCampaignV1ContactListAddParams = {
  resource: 'contactList';
  operation: 'add';
/**
 * List ID
 */
    listId?: number | Expression<number>;
/**
 * Contact ID
 */
    contactId?: number | Expression<number>;
};

export type ActiveCampaignV1ContactListAddOutput = {
  success?: boolean;
};

export type ActiveCampaignV1ContactListAddNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ContactListAddParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1ContactListAddOutput>;
};
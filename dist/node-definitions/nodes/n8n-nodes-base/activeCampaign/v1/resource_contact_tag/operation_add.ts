/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=contactTag, operation=add
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Add contact to a list */
export type ActiveCampaignV1ContactTagAddParams = {
  resource: 'contactTag';
  operation: 'add';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTags
 */
    tagId: string | Expression<string>;
/**
 * Contact ID
 */
    contactId?: number | Expression<number>;
};

export type ActiveCampaignV1ContactTagAddOutput = {
  cdate?: string;
  created_by?: null;
  created_timestamp?: string;
  id?: string;
  links?: {
    contact?: string;
    tag?: string;
  };
  updated_by?: null;
  updated_timestamp?: string;
};

export type ActiveCampaignV1ContactTagAddNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ContactTagAddParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1ContactTagAddOutput>;
};
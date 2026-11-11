/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=tag, operation=update
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Update an account */
export type ActiveCampaignV1TagUpdateParams = {
  resource: 'tag';
  operation: 'update';
/**
 * ID of the tag to update
 * @default 0
 */
    tagId?: number | Expression<number>;
/**
 * The fields to update
 * @default {}
 */
    updateFields?: {
    /** Name of the contact
     */
    tag?: string | Expression<string>;
    /** Description of the tag being updated
     */
    description?: string | Expression<string>;
  };
};

export type ActiveCampaignV1TagUpdateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1TagUpdateParams> & { credentials?: Credentials };
};
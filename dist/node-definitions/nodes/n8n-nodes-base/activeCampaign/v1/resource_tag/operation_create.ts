/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=tag, operation=create
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Create an account */
export type ActiveCampaignV1TagCreateParams = {
  resource: 'tag';
  operation: 'create';
/**
 * Tag-type of the new tag
 * @default contact
 */
    tagType?: 'contact' | 'template' | Expression<string>;
/**
 * Name of the new tag
 */
    name: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Description of the new tag
     */
    description?: string | Expression<string>;
  };
};

export type ActiveCampaignV1TagCreateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1TagCreateParams> & { credentials?: Credentials };
};
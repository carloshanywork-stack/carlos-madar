/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=account, operation=create
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Create an account */
export type ActiveCampaignV1AccountCreateParams = {
  resource: 'account';
  operation: 'create';
/**
 * Account's name
 */
    name: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Account's website
     */
    accountUrl?: string | Expression<string>;
    /** Adds a custom fields to set also values which have not been predefined
     * @default {}
     */
    fields?: {
        /** Field
     */
    property?: Array<{
      /** ID of the field to set. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
       * @loadOptionsMethod getAccountCustomFields
       */
      customFieldId?: string | Expression<string>;
      /** Value of the field to set
       */
      fieldValue?: string | Expression<string>;
    }>;
  };
  };
};

export type ActiveCampaignV1AccountCreateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1AccountCreateParams> & { credentials?: Credentials };
};
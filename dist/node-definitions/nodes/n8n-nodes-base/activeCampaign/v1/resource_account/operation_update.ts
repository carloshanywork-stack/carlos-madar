/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=account, operation=update
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Update an account */
export type ActiveCampaignV1AccountUpdateParams = {
  resource: 'account';
  operation: 'update';
/**
 * ID of the account to update
 * @default 0
 */
    accountId?: number | Expression<number>;
/**
 * The fields to update
 * @default {}
 */
    updateFields?: {
    /** Account's name
     */
    name?: string | Expression<string>;
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

export type ActiveCampaignV1AccountUpdateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1AccountUpdateParams> & { credentials?: Credentials };
};
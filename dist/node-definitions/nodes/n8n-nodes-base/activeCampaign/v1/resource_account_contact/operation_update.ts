/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=accountContact, operation=update
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Update an account */
export type ActiveCampaignV1AccountContactUpdateParams = {
  resource: 'accountContact';
  operation: 'update';
/**
 * Account ID
 */
    accountContactId?: number | Expression<number>;
/**
 * The fields to update
 * @default {}
 */
    updateFields?: {
    /** Job Title of the contact at the account
     */
    jobTitle?: string | Expression<string>;
  };
};

export type ActiveCampaignV1AccountContactUpdateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1AccountContactUpdateParams> & { credentials?: Credentials };
};
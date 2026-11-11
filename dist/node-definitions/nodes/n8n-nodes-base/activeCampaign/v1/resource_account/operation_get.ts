/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=account, operation=get
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of an account */
export type ActiveCampaignV1AccountGetParams = {
  resource: 'account';
  operation: 'get';
/**
 * ID of the account to get
 * @default 0
 */
    accountId?: number | Expression<number>;
};

export type ActiveCampaignV1AccountGetOutput = {
  account?: {
    accountUrl?: string;
    createdTimestamp?: string;
    updatedTimestamp?: string;
    id?: string;
    links?: {
      accountContacts?: string;
      accountCustomFieldData?: string;
      contactEmails?: string;
      emailActivities?: string;
      notes?: string;
      owner?: string;
    };
    name?: string;
    owner?: string;
  };
};

export type ActiveCampaignV1AccountGetNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1AccountGetParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1AccountGetOutput>;
};
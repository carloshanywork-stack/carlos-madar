/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=account, operation=getAll
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of many accounts */
export type ActiveCampaignV1AccountGetAllParams = {
  resource: 'account';
  operation: 'getAll';
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
/**
 * Filters
 * @default {}
 */
    filters?: {
    /** Search by name
     */
    search?: string | Expression<string>;
  };
};

export type ActiveCampaignV1AccountGetAllOutput = {
  contactCount?: string;
  createdTimestamp?: string;
  dealCount?: string;
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
  updatedTimestamp?: string;
};

export type ActiveCampaignV1AccountGetAllNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1AccountGetAllParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1AccountGetAllOutput>;
};
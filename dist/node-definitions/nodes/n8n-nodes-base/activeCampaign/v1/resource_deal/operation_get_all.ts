/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=deal, operation=getAll
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of many accounts */
export type ActiveCampaignV1DealGetAllParams = {
  resource: 'deal';
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
};

export type ActiveCampaignV1DealGetAllOutput = {
  activitycount?: string;
  cdate?: string;
  currency?: string;
  description?: string;
  group?: string;
  hash?: string;
  id?: string;
  isDisabled?: boolean;
  links?: {
    account?: string;
    contact?: string;
    contactDeals?: string;
    customerAccount?: string;
    dealActivities?: string;
    dealCustomFieldData?: string;
    group?: string;
    nextTask?: string;
    notes?: string;
    organization?: string;
    owner?: string;
    scoreValues?: string;
    stage?: string;
    tasks?: string;
  };
  mdate?: string;
  nextdealid?: string;
  owner?: string;
  percent?: string;
  stage?: string;
  status?: string;
  title?: string;
  value?: string;
};

export type ActiveCampaignV1DealGetAllNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1DealGetAllParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1DealGetAllOutput>;
};
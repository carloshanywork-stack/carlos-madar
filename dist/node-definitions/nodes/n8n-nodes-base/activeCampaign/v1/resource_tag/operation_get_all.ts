/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=tag, operation=getAll
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of many accounts */
export type ActiveCampaignV1TagGetAllParams = {
  resource: 'tag';
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

export type ActiveCampaignV1TagGetAllOutput = {
  created_timestamp?: string;
  deleted?: string;
  description?: string;
  id?: string;
  links?: {
    contactGoalTags?: string;
    templateTags?: string;
  };
  subscriber_count?: string;
  tag?: string;
  tagType?: string;
  updated_timestamp?: string;
};

export type ActiveCampaignV1TagGetAllNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1TagGetAllParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1TagGetAllOutput>;
};
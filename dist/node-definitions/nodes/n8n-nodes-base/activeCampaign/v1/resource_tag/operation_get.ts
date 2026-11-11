/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=tag, operation=get
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of an account */
export type ActiveCampaignV1TagGetParams = {
  resource: 'tag';
  operation: 'get';
/**
 * ID of the tag to get
 * @default 0
 */
    tagId?: number | Expression<number>;
};

export type ActiveCampaignV1TagGetOutput = {
  tag?: {
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
};

export type ActiveCampaignV1TagGetNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1TagGetParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1TagGetOutput>;
};
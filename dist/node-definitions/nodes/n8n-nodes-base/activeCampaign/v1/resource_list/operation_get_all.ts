/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=list, operation=getAll
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of many accounts */
export type ActiveCampaignV1ListGetAllParams = {
  resource: 'list';
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

export type ActiveCampaignV1ListGetAllOutput = {
  analytics_domains?: null;
  analytics_source?: string;
  analytics_ua?: string;
  cdate?: string;
  created_by?: null;
  created_timestamp?: string;
  deletestamp?: null;
  facebook_session?: null;
  get_unsubscribe_reason?: string;
  id?: string;
  links?: {
    addressLists?: string;
    contactGoalLists?: string;
    user?: string;
  };
  name?: string;
  optinmessageid?: string;
  optinoptout?: string;
  optoutconf?: string;
  p_embed_image?: string;
  p_use_analytics_link?: string;
  p_use_analytics_read?: string;
  p_use_captcha?: string;
  p_use_facebook?: string;
  p_use_tracking?: string;
  p_use_twitter?: string;
  private?: string;
  require_name?: string;
  send_last_broadcast?: string;
  sender_addr1?: string;
  sender_addr2?: string;
  sender_city?: string;
  sender_country?: string;
  sender_name?: string;
  sender_phone?: string;
  sender_reminder?: string;
  sender_state?: string;
  sender_url?: string;
  sender_zip?: string;
  stringid?: string;
  to_name?: string;
  twitter_token?: string;
  twitter_token_secret?: string;
  updated_by?: null;
  updated_timestamp?: string;
  user?: string;
  userid?: string;
};

export type ActiveCampaignV1ListGetAllNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ListGetAllParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1ListGetAllOutput>;
};
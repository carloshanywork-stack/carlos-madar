/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=contact, operation=get
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of an account */
export type ActiveCampaignV1ContactGetParams = {
  resource: 'contact';
  operation: 'get';
/**
 * ID of the contact to get
 * @default 0
 */
    contactId?: number | Expression<number>;
};

export type ActiveCampaignV1ContactGetOutput = {
  accountContacts?: Array<{
    account?: string;
    contact?: string;
    createdTimestamp?: string;
    id?: string;
    jobTitle?: string;
    links?: {
      account?: string;
      contact?: string;
    };
    updatedTimestamp?: string;
  }>;
  contact?: {
    accountContacts?: Array<string>;
    anonymized?: string;
    bounced_hard?: string;
    bounced_soft?: string;
    cdate?: string;
    contactAutomations?: Array<string>;
    contactData?: string;
    contactLists?: Array<string>;
    created_timestamp?: string;
    created_utc_timestamp?: string;
    deals?: Array<string>;
    deleted?: string;
    deleted_at?: null;
    email?: string;
    email_domain?: string;
    email_local?: string;
    fieldValues?: Array<string>;
    firstName?: string;
    geoIps?: Array<string>;
    gravatar?: string;
    hash?: string;
    id?: string;
    ip?: string;
    lastName?: string;
    links?: {
      accountContacts?: string;
      automationEntryCounts?: string;
      bounceLogs?: string;
      contactAutomations?: string;
      contactData?: string;
      contactDeals?: string;
      contactGoals?: string;
      contactLists?: string;
      contactLogs?: string;
      contactTags?: string;
      deals?: string;
      fieldValues?: string;
      geoIps?: string;
      notes?: string;
      organization?: string;
      plusAppend?: string;
      scoreValues?: string;
      trackingLogs?: string;
    };
    mpp_tracking?: string;
    orgid?: string;
    orgname?: string;
    phone?: string;
    segmentio_id?: string;
    sentcnt?: string;
    socialdata_lastcheck?: null;
    udate?: string;
    updated_timestamp?: string;
    updated_utc_timestamp?: string;
  };
  contactAutomations?: Array<{
    adddate?: string;
    automation?: string;
    completed?: number;
    completedElements?: number;
    completeValue?: number;
    contact?: string;
    id?: string;
    lastblock?: string;
    lastdate?: string;
    lastlogid?: string;
    links?: {
      automation?: string;
      automationLogs?: string;
      contact?: string;
      contactGoals?: string;
    };
    seriesid?: string;
    startid?: string;
    status?: string;
    totalElements?: number;
  }>;
  contactData?: Array<{
    contact?: string;
    created_timestamp?: string;
    fb_id?: string;
    fb_name?: string;
    ga_campaign_content?: string;
    ga_campaign_customsegment?: string;
    ga_campaign_medium?: string;
    ga_campaign_name?: string;
    ga_campaign_source?: string;
    ga_campaign_term?: string;
    ga_first_visit?: null;
    ga_times_visited?: string;
    geo_country?: string;
    geoArea?: string;
    geoCity?: string;
    geoCountry2?: string;
    geoIp4?: string;
    geoLat?: string;
    geoLon?: string;
    geoState?: string;
    geoTz?: string;
    geoTzOffset?: string;
    geoZip?: string;
    id?: string;
    tstamp?: string;
    tw_id?: string;
    updated_timestamp?: string;
  }>;
  contactLists?: Array<{
    autosyncLog?: null;
    contact?: string;
    created_timestamp?: string;
    first_name?: string;
    id?: string;
    ip4_last?: string;
    ip4Sub?: string;
    ip4Unsub?: string;
    last_name?: string;
    links?: {
      automation?: string;
      autosyncLog?: string;
      campaign?: string;
      contact?: string;
      form?: string;
      list?: string;
      message?: string;
      unsubscribeAutomation?: string;
    };
    list?: string;
    message?: null;
    responder?: string;
    sdate?: string;
    seriesid?: string;
    sourceid?: string;
    status?: string;
    sync?: string;
    updated_timestamp?: string;
  }>;
  deals?: Array<{
    activitycount?: string;
    cdate?: string;
    contact?: string;
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
    winProbability?: null;
  }>;
  fieldValues?: Array<{
    cdate?: string;
    contact?: string;
    id?: string;
    links?: {
      field?: string;
      owner?: string;
    };
    owner?: string;
    udate?: string;
    value?: string;
  }>;
  geoIps?: Array<{
    campaignid?: string;
    contact?: string;
    geoAddress?: string;
    geoaddrid?: string;
    id?: string;
    ip4?: string;
    links?: {
      geoAddress?: string;
    };
    messageid?: string;
    tstamp?: string;
  }>;
};

export type ActiveCampaignV1ContactGetNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ContactGetParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1ContactGetOutput>;
};
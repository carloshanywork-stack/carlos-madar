/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=contact, operation=getAll
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Get data of many accounts */
export type ActiveCampaignV1ContactGetAllParams = {
  resource: 'contact';
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
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Contacts created on the specified date
     */
    datetime?: string | Expression<string>;
    /** Email address of the contact you want to get
     */
    email?: string | Expression<string>;
    /** Filter contacts that contain the given value in the email address
     */
    email_like?: string | Expression<string>;
    /** Exclude from the response the contact with the given ID
     */
    exclude?: string | Expression<string>;
    /** Filter contacts associated with the given form
     */
    formid?: string | Expression<string>;
    /** Filter contacts associated with the given list
     */
    listid?: string | Expression<string>;
    /** Filter contacts that match the given value in the contact names, organization, phone or email
     */
    search?: string | Expression<string>;
    /** Return only contacts that match a list segment
     */
    segmentid?: string | Expression<string>;
    /** Filter contacts associated with the given automation
     */
    seriesid?: string | Expression<string>;
    /** Status
     */
    status?: 1 | -1 | 3 | 0 | 2 | Expression<number>;
    /** Filter contacts associated with the given tag
     */
    tagid?: string | Expression<string>;
    /** Filter contacts that were created prior to this date
     */
    'filters[created_before]'?: string | Expression<string>;
    /** Filter contacts that were created after this date
     */
    'filters[created_after]'?: string | Expression<string>;
    /** Filter contacts that were updated before this date
     */
    'filters[updated_before]'?: string | Expression<string>;
    /** Filter contacts that were updated after this date
     */
    'filters[updated_after]'?: string | Expression<string>;
    /** Filter by contacts in the wait queue of an automation block
     */
    waitid?: string | Expression<string>;
    /** Order By
     */
    orderBy?: 'orders[cdate]' | 'orders[email]' | 'orders[first_name]' | 'orders[last_name]' | 'orders[name]' | 'orders[score]' | Expression<string>;
  };
};

export type ActiveCampaignV1ContactGetAllOutput = {
  anonymized?: string;
  bounced_hard?: string;
  bounced_soft?: string;
  created_timestamp?: string;
  created_utc_timestamp?: string;
  deleted?: string;
  deleted_at?: null;
  email?: string;
  email_domain?: string;
  email_local?: string;
  firstName?: string;
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

export type ActiveCampaignV1ContactGetAllNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ContactGetAllParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1ContactGetAllOutput>;
};
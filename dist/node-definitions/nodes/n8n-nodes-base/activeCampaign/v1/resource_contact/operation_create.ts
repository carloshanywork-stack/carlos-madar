/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=contact, operation=create
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Create an account */
export type ActiveCampaignV1ContactCreateParams = {
  resource: 'contact';
  operation: 'create';
/**
 * The email of the contact to create
 */
    email: string | Expression<string>;
/**
 * Whether to update user if it exists already. If not set and user exists it will error instead.
 * @default false
 */
    updateIfExists?: boolean | Expression<boolean>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Adds a custom fields to set also values which have not been predefined
     * @default {}
     */
    fieldValues?: {
        /** Custom Field
     */
    property?: Array<{
      /** ID of the field to set. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
       * @loadOptionsMethod getContactCustomFields
       */
      field?: string | Expression<string>;
      /** Value of the field to set
       */
      value?: string | Expression<string>;
    }>;
  };
    /** The first name of the contact to create
     */
    firstName?: string | Expression<string>;
    /** The last name of the contact to create
     */
    lastName?: string | Expression<string>;
    /** Phone number of the contact
     */
    phone?: string | Expression<string>;
  };
};

export type ActiveCampaignV1ContactCreateOutput = {
  anonymized?: string;
  bounced_hard?: string;
  bounced_soft?: string;
  cdate?: string;
  created_timestamp?: string;
  created_utc_timestamp?: string;
  deleted?: string;
  email?: string;
  email_domain?: string;
  email_local?: string;
  fieldValues?: Array<string>;
  firstName?: string;
  gravatar?: string;
  hash?: string;
  id?: string;
  ip?: string;
  lastName?: string;
  links?: {
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

export type ActiveCampaignV1ContactCreateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ContactCreateParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1ContactCreateOutput>;
};
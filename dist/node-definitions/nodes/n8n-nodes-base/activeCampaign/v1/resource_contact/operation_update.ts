/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=contact, operation=update
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Update an account */
export type ActiveCampaignV1ContactUpdateParams = {
  resource: 'contact';
  operation: 'update';
/**
 * ID of the contact to update
 * @default 0
 */
    contactId?: number | Expression<number>;
/**
 * The fields to update
 * @default {}
 */
    updateFields?: {
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
    /** Email of the contact
     */
    email?: string | Expression<string>;
    /** First name of the contact
     */
    firstName?: string | Expression<string>;
    /** Last name of the contact
     */
    lastName?: string | Expression<string>;
    /** Phone number of the contact
     */
    phone?: string | Expression<string>;
  };
};

export type ActiveCampaignV1ContactUpdateOutput = {
  anonymized?: string;
  bounced_hard?: string;
  bounced_soft?: string;
  cdate?: string;
  created_timestamp?: string;
  created_utc_timestamp?: string;
  deleted?: string;
  deleted_at?: null;
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

export type ActiveCampaignV1ContactUpdateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1ContactUpdateParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1ContactUpdateOutput>;
};
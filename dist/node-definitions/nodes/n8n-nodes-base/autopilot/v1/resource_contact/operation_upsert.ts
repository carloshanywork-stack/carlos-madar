/**
 * Autopilot Node - Version 1
 * Discriminator: resource=contact, operation=upsert
 */


interface Credentials {
  autopilotApi: CredentialReference;
}

/** Create a new contact, or update the current one if it already exists (upsert) */
export type AutopilotV1ContactUpsertParams = {
  resource: 'contact';
  operation: 'upsert';
/**
 * Email address of the contact
 */
    email: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Company
     */
    Company?: string | Expression<string>;
    /** Custom Fields
     * @loadOptionsMethod getCustomFields
     * @default {}
     */
    customFieldsUi?: string | Expression<string>;
    /** Fax
     */
    Fax?: string | Expression<string>;
    /** First Name
     */
    FirstName?: string | Expression<string>;
    /** Industry
     */
    Industry?: string | Expression<string>;
    /** Last Name
     */
    LastName?: string | Expression<string>;
    /** Lead Source
     */
    LeadSource?: string | Expression<string>;
    /** LinkedIn URL
     */
    LinkedIn?: string | Expression<string>;
    /** List to which this contact will be added on creation. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getLists
     */
    autopilotList?: string | Expression<string>;
    /** Mailing Country
     */
    MailingCountry?: string | Expression<string>;
    /** Mailing Postal Code
     */
    MailingPostalCode?: string | Expression<string>;
    /** Mailing State
     */
    MailingState?: string | Expression<string>;
    /** Mailing Street
     */
    MailingStreet?: string | Expression<string>;
    /** Mailing City
     */
    MailingCity?: string | Expression<string>;
    /** Mobile Phone
     */
    MobilePhone?: string | Expression<string>;
    /** If provided, will change the email address of the contact identified by the Email field
     */
    newEmail?: string | Expression<string>;
    /** By default Autopilot notifies registered REST hook endpoints for contact_added/contact_updated events when a new contact is added or an existing contact is updated via API. Disable to skip notifications.
     * @default true
     */
    notify?: boolean | Expression<boolean>;
    /** Number of Employees
     * @default 0
     */
    NumberOfEmployees?: number | Expression<number>;
    /** Owner Name
     */
    owner_name?: string | Expression<string>;
    /** Phone
     */
    Phone?: string | Expression<string>;
    /** Salutation
     */
    Salutation?: string | Expression<string>;
    /** Used to associate a contact with a session
     */
    autopilotSessionId?: string | Expression<string>;
    /** Status
     */
    Status?: string | Expression<string>;
    /** Title
     */
    Title?: string | Expression<string>;
    /** Whether to subscribe or un-subscribe a contact
     * @default false
     */
    unsubscribed?: boolean | Expression<boolean>;
    /** Website URL
     */
    Website?: string | Expression<string>;
  };
};

export type AutopilotV1ContactUpsertNode = {
  type: 'n8n-nodes-base.autopilot';
  version: 1;
  config: NodeConfig<AutopilotV1ContactUpsertParams> & { credentials?: Credentials };
};
/**
 * ClickUp Node - Version 1
 * Discriminator: resource=timeEntry, operation=start
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Start a time entry */
export type ClickUpV1TimeEntryStartParams = {
  resource: 'timeEntry';
  operation: 'start';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTeams
 */
    team: string | Expression<string>;
/**
 * Task ID
 */
    task: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Billable
     * @default true
     */
    billable?: boolean | Expression<boolean>;
    /** Description of the time entry
     */
    description?: string | Expression<string>;
  };
};

export type ClickUpV1TimeEntryStartNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TimeEntryStartParams> & { credentials?: Credentials };
};
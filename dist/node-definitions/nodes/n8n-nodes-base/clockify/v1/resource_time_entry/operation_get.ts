/**
 * Clockify Node - Version 1
 * Discriminator: resource=timeEntry, operation=get
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Get a client */
export type ClockifyV1TimeEntryGetParams = {
  resource: 'timeEntry';
  operation: 'get';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
/**
 * Time Entry ID
 */
    timeEntryId: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Whether to return the time entry's duration rounded to minutes or seconds based on duration format (hh:mm or hh:mm:ss) from workspace settings
     * @default false
     */
    'consider-duration-format'?: boolean | Expression<boolean>;
    /** Whether to return the time entry's project, task and tags in full and not just their IDs
     * @default false
     */
    hydrated?: boolean | Expression<boolean>;
  };
};

export type ClockifyV1TimeEntryGetNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1TimeEntryGetParams> & { credentials?: Credentials };
};
/**
 * ClickUp Node - Version 1
 * Discriminator: resource=timeEntry, operation=get
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get a folder */
export type ClickUpV1TimeEntryGetParams = {
  resource: 'timeEntry';
  operation: 'get';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTeams
 */
    team: string | Expression<string>;
/**
 * Whether to return just the current running time entry
 * @default false
 */
    running?: boolean | Expression<boolean>;
/**
 * Time Entry ID
 * @displayOptions.show { running: [false] }
 * @required when the displayOptions conditions above match
 */
    timeEntry?: string | Expression<string>;
};

export type ClickUpV1TimeEntryGetNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TimeEntryGetParams> & { credentials?: Credentials };
};
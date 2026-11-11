/**
 * ClickUp Node - Version 1
 * Discriminator: resource=timeEntry, operation=stop
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Stop the current running timer */
export type ClickUpV1TimeEntryStopParams = {
  resource: 'timeEntry';
  operation: 'stop';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTeams
 */
    team: string | Expression<string>;
};

export type ClickUpV1TimeEntryStopNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TimeEntryStopParams> & { credentials?: Credentials };
};
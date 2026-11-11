/**
 * ClickUp Node - Version 1
 * Discriminator: resource=timeEntry, operation=delete
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Delete a checklist */
export type ClickUpV1TimeEntryDeleteParams = {
  resource: 'timeEntry';
  operation: 'delete';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTeams
 */
    team: string | Expression<string>;
/**
 * Time Entry ID
 */
    timeEntry: string | Expression<string>;
};

export type ClickUpV1TimeEntryDeleteNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TimeEntryDeleteParams> & { credentials?: Credentials };
};
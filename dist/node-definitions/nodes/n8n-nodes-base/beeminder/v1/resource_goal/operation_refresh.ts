/**
 * Beeminder Node - Version 1
 * Discriminator: resource=goal, operation=refresh
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Refresh goal data */
export type BeeminderV1GoalRefreshParams = {
  resource: 'goal';
  operation: 'refresh';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * The name of the goal. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getGoals
 */
    goalName: string | Expression<string>;
};

export type BeeminderV1GoalRefreshNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1GoalRefreshParams> & { credentials?: Credentials };
};
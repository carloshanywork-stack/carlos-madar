/**
 * Beeminder Node - Version 1
 * Discriminator: resource=goal, operation=uncle
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Derail a goal and charge the pledge amount */
export type BeeminderV1GoalUncleParams = {
  resource: 'goal';
  operation: 'uncle';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * The name of the goal to derail. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getGoals
 */
    goalName: string | Expression<string>;
};

export type BeeminderV1GoalUncleNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1GoalUncleParams> & { credentials?: Credentials };
};
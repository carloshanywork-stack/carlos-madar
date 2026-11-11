/**
 * Beeminder Node - Version 1
 * Discriminator: resource=goal, operation=stepDown
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Step down pledge */
export type BeeminderV1GoalStepDownParams = {
  resource: 'goal';
  operation: 'stepDown';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * The name of the goal. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getGoals
 */
    goalName: string | Expression<string>;
};

export type BeeminderV1GoalStepDownNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1GoalStepDownParams> & { credentials?: Credentials };
};
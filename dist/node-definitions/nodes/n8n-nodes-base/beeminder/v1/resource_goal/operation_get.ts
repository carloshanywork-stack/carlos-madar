/**
 * Beeminder Node - Version 1
 * Discriminator: resource=goal, operation=get
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Get a single datapoint */
export type BeeminderV1GoalGetParams = {
  resource: 'goal';
  operation: 'get';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * The name of the goal. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getGoals
 */
    goalName: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Whether to include datapoints in the response
     * @default false
     */
    datapoints?: boolean | Expression<boolean>;
    /** Whether to include the goal attributes called road, roadall, and fullroad will be stripped from the goal object
     * @default false
     */
    emaciated?: boolean | Expression<boolean>;
  };
};

export type BeeminderV1GoalGetNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1GoalGetParams> & { credentials?: Credentials };
};
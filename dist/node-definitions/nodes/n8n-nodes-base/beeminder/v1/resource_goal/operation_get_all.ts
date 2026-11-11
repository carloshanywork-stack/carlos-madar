/**
 * Beeminder Node - Version 1
 * Discriminator: resource=goal, operation=getAll
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Get many datapoints for a goal */
export type BeeminderV1GoalGetAllParams = {
  resource: 'goal';
  operation: 'getAll';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Whether to include the goal attributes called road, roadall, and fullroad will be stripped from the goal objects
     * @default false
     */
    emaciated?: boolean | Expression<boolean>;
  };
};

export type BeeminderV1GoalGetAllNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1GoalGetAllParams> & { credentials?: Credentials };
};
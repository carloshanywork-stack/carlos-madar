/**
 * Beeminder Node - Version 1
 * Discriminator: resource=goal, operation=getArchived
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Get archived goals */
export type BeeminderV1GoalGetArchivedParams = {
  resource: 'goal';
  operation: 'getArchived';
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

export type BeeminderV1GoalGetArchivedNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1GoalGetArchivedParams> & { credentials?: Credentials };
};
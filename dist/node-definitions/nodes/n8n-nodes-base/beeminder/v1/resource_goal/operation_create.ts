/**
 * Beeminder Node - Version 1
 * Discriminator: resource=goal, operation=create
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Create a charge */
export type BeeminderV1GoalCreateParams = {
  resource: 'goal';
  operation: 'create';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * Unique identifier for the goal
 */
    slug: string | Expression<string>;
/**
 * Human-readable title for the goal
 */
    title: string | Expression<string>;
/**
 * Type of goal. &lt;a href="https://api.beeminder.com/#attributes-2"&gt;More info here.&lt;/a&gt;.
 * @default hustler
 */
    goal_type?: 'hustler' | 'biker' | 'fatloser' | 'gainer' | 'inboxer' | 'drinker' | 'custom' | Expression<string>;
/**
 * Units for the goal (e.g., "hours", "pages", "pounds")
 */
    gunits: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Target date for the goal
     */
    goaldate?: string | Expression<string>;
    /** Target value for the goal
     */
    goalval?: number | Expression<number>;
    /** Rate of progress (units per day)
     */
    rate?: number | Expression<number>;
    /** Initial value for today's date
     * @default 0
     */
    initval?: number | Expression<number>;
    /** Whether the goal is secret
     * @default false
     */
    secret?: boolean | Expression<boolean>;
    /** Whether the data is public
     * @default false
     */
    datapublic?: boolean | Expression<boolean>;
    /** Data source for the goal
     * @default manual
     */
    datasource?: 'api' | 'ifttt' | 'zapier' | 'manual' | Expression<string>;
    /** Whether to test the endpoint without actually creating a goal
     * @default false
     */
    dryrun?: boolean | Expression<boolean>;
    /** Array of alphanumeric tags for the goal. Replaces existing tags.
     * @default []
     */
    tags?: IDataObject | string | Expression<string>;
  };
};

export type BeeminderV1GoalCreateNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1GoalCreateParams> & { credentials?: Credentials };
};
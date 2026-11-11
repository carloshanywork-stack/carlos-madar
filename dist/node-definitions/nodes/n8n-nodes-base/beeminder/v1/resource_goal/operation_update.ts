/**
 * Beeminder Node - Version 1
 * Discriminator: resource=goal, operation=update
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Update a datapoint */
export type BeeminderV1GoalUpdateParams = {
  resource: 'goal';
  operation: 'update';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * The name of the goal. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getGoals
 */
    goalName: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Human-readable title for the goal
     */
    title?: string | Expression<string>;
    /** Y-axis label for the goal graph
     */
    yaxis?: string | Expression<string>;
    /** Minimum date for the goal in format yyyy-mm-dd
     */
    tmin?: string | Expression<string>;
    /** Maximum date for the goal in format yyyy-mm-dd
     */
    tmax?: string | Expression<string>;
    /** Whether the goal is secret
     * @default false
     */
    secret?: boolean | Expression<boolean>;
    /** Whether the data is public
     * @default false
     */
    datapublic?: boolean | Expression<boolean>;
    /** Array of arrays defining the bright red line. Each sub-array contains [date, value, rate] with exactly one field null.
     * @default []
     */
    roadall?: IDataObject | string | Expression<string>;
    /** Data source for the goal. Use empty string for manual entry.
     */
    datasource?: 'api' | 'ifttt' | 'zapier' | '' | Expression<string>;
    /** Array of alphanumeric tags for the goal. Replaces existing tags.
     * @default []
     */
    tags?: IDataObject | string | Expression<string>;
  };
};

export type BeeminderV1GoalUpdateNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1GoalUpdateParams> & { credentials?: Credentials };
};
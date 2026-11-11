/**
 * Beeminder Node - Version 1
 * Discriminator: resource=datapoint, operation=getAll
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Get many datapoints for a goal */
export type BeeminderV1DatapointGetAllParams = {
  resource: 'datapoint';
  operation: 'getAll';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * The name of the goal. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getGoals
 */
    goalName: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 30
 */
    limit?: number | Expression<number>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Attribute to sort on
     * @default id
     */
    sort?: string | Expression<string>;
    /** Used to paginate results, 1-indexed, meaning page 1 is the first page
     * @displayOptions.show { /returnAll: [false] }
     * @default 1
     */
    page?: number | Expression<number>;
    /** Number of results per page. Default 25. Ignored without page parameter. Must be non-negative
     * @displayOptions.show { /returnAll: [false] }
     * @default 25
     */
    per?: number | Expression<number>;
  };
};

export type BeeminderV1DatapointGetAllNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1DatapointGetAllParams> & { credentials?: Credentials };
};
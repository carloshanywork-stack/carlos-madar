/**
 * Beeminder Node - Version 1
 * Discriminator: resource=user, operation=get
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Get a single datapoint */
export type BeeminderV1UserGetParams = {
  resource: 'user';
  operation: 'get';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Whether to include associations in the response
     * @default false
     */
    associations?: boolean | Expression<boolean>;
    /** Only goals and datapoints that have been created or updated since the timestamp will be returned
     */
    diff_since?: string | Expression<string>;
    /** Whether to return minimal user data
     * @default false
     */
    skinny?: boolean | Expression<boolean>;
    /** Whether to include the goal attributes called road, roadall, and fullroad will be stripped from any goal objects returned with the user
     * @default false
     */
    emaciated?: boolean | Expression<boolean>;
    /** Number of datapoints to include
     */
    datapoints_count?: number | Expression<number>;
  };
};

export type BeeminderV1UserGetNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1UserGetParams> & { credentials?: Credentials };
};
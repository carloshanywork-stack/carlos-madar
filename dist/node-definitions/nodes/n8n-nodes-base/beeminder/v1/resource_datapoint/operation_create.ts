/**
 * Beeminder Node - Version 1
 * Discriminator: resource=datapoint, operation=create
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Create a charge */
export type BeeminderV1DatapointCreateParams = {
  resource: 'datapoint';
  operation: 'create';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * The name of the goal. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getGoals
 */
    goalName: string | Expression<string>;
/**
 * Datapoint value to send
 * @default 1
 */
    value?: number | Expression<number>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Comment
     */
    comment?: string | Expression<string>;
    /** Defaults to "now" if none is passed in, or the existing timestamp if the datapoint is being updated rather than created
     */
    timestamp?: string | Expression<string>;
    /** String to uniquely identify a datapoint
     */
    requestid?: string | Expression<string>;
  };
};

export type BeeminderV1DatapointCreateNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1DatapointCreateParams> & { credentials?: Credentials };
};
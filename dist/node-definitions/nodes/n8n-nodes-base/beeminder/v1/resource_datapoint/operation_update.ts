/**
 * Beeminder Node - Version 1
 * Discriminator: resource=datapoint, operation=update
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Update a datapoint */
export type BeeminderV1DatapointUpdateParams = {
  resource: 'datapoint';
  operation: 'update';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * The name of the goal. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getGoals
 */
    goalName: string | Expression<string>;
/**
 * Datapoint ID
 */
    datapointId: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Datapoint value to send
     * @default 1
     */
    value?: number | Expression<number>;
    /** Comment
     */
    comment?: string | Expression<string>;
    /** Defaults to "now" if none is passed in, or the existing timestamp if the datapoint is being updated rather than created
     */
    timestamp?: string | Expression<string>;
  };
};

export type BeeminderV1DatapointUpdateNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1DatapointUpdateParams> & { credentials?: Credentials };
};
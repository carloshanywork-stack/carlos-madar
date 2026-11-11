/**
 * Beeminder Node - Version 1
 * Discriminator: resource=datapoint, operation=delete
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Delete a datapoint */
export type BeeminderV1DatapointDeleteParams = {
  resource: 'datapoint';
  operation: 'delete';
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
};

export type BeeminderV1DatapointDeleteNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1DatapointDeleteParams> & { credentials?: Credentials };
};
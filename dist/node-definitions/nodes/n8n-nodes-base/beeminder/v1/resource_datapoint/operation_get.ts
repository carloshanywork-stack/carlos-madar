/**
 * Beeminder Node - Version 1
 * Discriminator: resource=datapoint, operation=get
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Get a single datapoint */
export type BeeminderV1DatapointGetParams = {
  resource: 'datapoint';
  operation: 'get';
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

export type BeeminderV1DatapointGetNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1DatapointGetParams> & { credentials?: Credentials };
};
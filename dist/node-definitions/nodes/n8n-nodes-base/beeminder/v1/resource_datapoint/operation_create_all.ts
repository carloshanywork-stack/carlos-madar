/**
 * Beeminder Node - Version 1
 * Discriminator: resource=datapoint, operation=createAll
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Create multiple datapoints at once */
export type BeeminderV1DatapointCreateAllParams = {
  resource: 'datapoint';
  operation: 'createAll';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * The name of the goal. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getGoals
 */
    goalName: string | Expression<string>;
/**
 * Array of datapoint objects to create. Each object should contain value and optionally timestamp, comment, etc.
 * @default []
 */
    datapoints?: IDataObject | string | Expression<string>;
};

export type BeeminderV1DatapointCreateAllNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1DatapointCreateAllParams> & { credentials?: Credentials };
};
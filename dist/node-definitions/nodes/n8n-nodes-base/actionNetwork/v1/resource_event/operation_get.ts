/**
 * Action Network Node - Version 1
 * Discriminator: resource=event, operation=get
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1EventGetParams = {
  resource: 'event';
  operation: 'get';
/**
 * ID of the event to retrieve
 */
    eventId: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
};

export type ActionNetworkV1EventGetNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1EventGetParams> & { credentials?: Credentials };
};
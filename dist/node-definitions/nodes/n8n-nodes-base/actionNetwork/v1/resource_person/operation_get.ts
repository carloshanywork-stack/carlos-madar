/**
 * Action Network Node - Version 1
 * Discriminator: resource=person, operation=get
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1PersonGetParams = {
  resource: 'person';
  operation: 'get';
/**
 * ID of the person to retrieve
 */
    personId: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
};

export type ActionNetworkV1PersonGetNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1PersonGetParams> & { credentials?: Credentials };
};
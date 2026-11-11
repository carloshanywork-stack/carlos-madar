/**
 * Action Network Node - Version 1
 * Discriminator: resource=tag, operation=create
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1TagCreateParams = {
  resource: 'tag';
  operation: 'create';
/**
 * Name of the tag to create
 */
    name: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
};

export type ActionNetworkV1TagCreateNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1TagCreateParams> & { credentials?: Credentials };
};
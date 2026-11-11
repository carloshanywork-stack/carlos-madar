/**
 * Action Network Node - Version 1
 * Discriminator: resource=tag, operation=get
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1TagGetParams = {
  resource: 'tag';
  operation: 'get';
/**
 * ID of the tag to retrieve
 */
    tagId: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
};

export type ActionNetworkV1TagGetNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1TagGetParams> & { credentials?: Credentials };
};
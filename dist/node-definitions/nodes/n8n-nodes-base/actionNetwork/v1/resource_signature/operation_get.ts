/**
 * Action Network Node - Version 1
 * Discriminator: resource=signature, operation=get
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1SignatureGetParams = {
  resource: 'signature';
  operation: 'get';
/**
 * ID of the petition whose signature to retrieve
 */
    petitionId: string | Expression<string>;
/**
 * ID of the signature to retrieve
 */
    signatureId: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
};

export type ActionNetworkV1SignatureGetNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1SignatureGetParams> & { credentials?: Credentials };
};
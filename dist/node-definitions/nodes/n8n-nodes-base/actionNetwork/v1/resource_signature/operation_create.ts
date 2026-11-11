/**
 * Action Network Node - Version 1
 * Discriminator: resource=signature, operation=create
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1SignatureCreateParams = {
  resource: 'signature';
  operation: 'create';
/**
 * ID of the petition to sign
 */
    petitionId: string | Expression<string>;
/**
 * ID of the person whose signature to create
 */
    personId: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Comments to leave when signing this petition
     */
    comments?: string | Expression<string>;
  };
};

export type ActionNetworkV1SignatureCreateNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1SignatureCreateParams> & { credentials?: Credentials };
};
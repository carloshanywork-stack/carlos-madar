/**
 * Action Network Node - Version 1
 * Discriminator: resource=signature, operation=getAll
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1SignatureGetAllParams = {
  resource: 'signature';
  operation: 'getAll';
/**
 * ID of the petition whose signatures to retrieve
 */
    petitionId: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 50
 */
    limit?: number | Expression<number>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
};

export type ActionNetworkV1SignatureGetAllNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1SignatureGetAllParams> & { credentials?: Credentials };
};
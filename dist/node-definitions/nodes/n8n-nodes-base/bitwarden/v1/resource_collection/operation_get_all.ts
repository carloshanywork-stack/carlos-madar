/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=collection, operation=getAll
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1CollectionGetAllParams = {
  resource: 'collection';
  operation: 'getAll';
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 10
 */
    limit?: number | Expression<number>;
};

export type BitwardenV1CollectionGetAllNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1CollectionGetAllParams> & { credentials?: Credentials };
};
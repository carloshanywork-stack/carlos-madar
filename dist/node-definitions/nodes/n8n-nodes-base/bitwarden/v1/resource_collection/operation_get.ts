/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=collection, operation=get
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1CollectionGetParams = {
  resource: 'collection';
  operation: 'get';
/**
 * The identifier of the collection
 */
    collectionId: string | Expression<string>;
};

export type BitwardenV1CollectionGetNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1CollectionGetParams> & { credentials?: Credentials };
};
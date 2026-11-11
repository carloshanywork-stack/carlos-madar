/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=collection, operation=delete
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1CollectionDeleteParams = {
  resource: 'collection';
  operation: 'delete';
/**
 * The identifier of the collection
 */
    collectionId: string | Expression<string>;
};

export type BitwardenV1CollectionDeleteNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1CollectionDeleteParams> & { credentials?: Credentials };
};
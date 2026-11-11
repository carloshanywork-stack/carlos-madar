/**
 * Affinity Node - Version 1
 * Discriminator: resource=list, operation=get
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Get a list */
export type AffinityV1ListGetParams = {
  resource: 'list';
  operation: 'get';
/**
 * The unique ID of the list object to be retrieved
 */
    listId: string | Expression<string>;
};

export type AffinityV1ListGetNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1ListGetParams> & { credentials?: Credentials };
};
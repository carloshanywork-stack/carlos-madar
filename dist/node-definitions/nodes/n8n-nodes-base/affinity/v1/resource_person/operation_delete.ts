/**
 * Affinity Node - Version 1
 * Discriminator: resource=person, operation=delete
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Delete a list entry */
export type AffinityV1PersonDeleteParams = {
  resource: 'person';
  operation: 'delete';
/**
 * Unique identifier for the person
 */
    personId: string | Expression<string>;
};

export type AffinityV1PersonDeleteNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1PersonDeleteParams> & { credentials?: Credentials };
};
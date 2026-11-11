/**
 * Affinity Node - Version 1
 * Discriminator: resource=organization, operation=delete
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Delete a list entry */
export type AffinityV1OrganizationDeleteParams = {
  resource: 'organization';
  operation: 'delete';
/**
 * Unique identifier for the organization
 */
    organizationId: string | Expression<string>;
};

export type AffinityV1OrganizationDeleteNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1OrganizationDeleteParams> & { credentials?: Credentials };
};
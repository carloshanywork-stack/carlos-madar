/**
 * Affinity Node - Version 1
 * Discriminator: resource=organization, operation=update
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Update an organization */
export type AffinityV1OrganizationUpdateParams = {
  resource: 'organization';
  operation: 'update';
/**
 * Unique identifier for the organization
 */
    organizationId: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** The domain name of the organization
     */
    domain?: string | Expression<string>;
    /** The name of the organization
     */
    name?: string | Expression<string>;
    /** Persons that the new organization will be associated with. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getPersons
     * @default []
     */
    persons?: string[];
  };
};

export type AffinityV1OrganizationUpdateNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1OrganizationUpdateParams> & { credentials?: Credentials };
};
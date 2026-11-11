/**
 * Affinity Node - Version 1
 * Discriminator: resource=person, operation=update
 */


interface Credentials {
  affinityApi: CredentialReference;
}

/** Update an organization */
export type AffinityV1PersonUpdateParams = {
  resource: 'person';
  operation: 'update';
/**
 * Unique identifier for the person
 */
    personId: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** The first name of the person
     */
    firstName?: string | Expression<string>;
    /** The last name of the person
     */
    lastName?: string | Expression<string>;
    /** Organizations that the person is associated with. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getOrganizations
     * @default []
     */
    organizations?: string[];
  };
/**
 * The email addresses of the person
 * @default []
 */
    emails?: Array<string | Expression<string>>;
};

export type AffinityV1PersonUpdateNode = {
  type: 'n8n-nodes-base.affinity';
  version: 1;
  config: NodeConfig<AffinityV1PersonUpdateParams> & { credentials?: Credentials };
};
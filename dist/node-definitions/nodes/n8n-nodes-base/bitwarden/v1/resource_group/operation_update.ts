/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=group, operation=update
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1GroupUpdateParams = {
  resource: 'group';
  operation: 'update';
/**
 * The identifier of the group
 */
    groupId: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Whether to allow this group to access all collections within the organization, instead of only its associated collections. If set to true, this option overrides any collection assignments.
     * @default false
     */
    accessAll?: boolean | Expression<boolean>;
    /** The collections to assign to this group. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getCollections
     * @default []
     */
    collections?: string[];
    /** The external identifier to set to this group
     */
    externalId?: string | Expression<string>;
    /** The name of the group to update
     */
    name?: string | Expression<string>;
  };
};

export type BitwardenV1GroupUpdateNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1GroupUpdateParams> & { credentials?: Credentials };
};
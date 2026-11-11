/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=group, operation=create
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1GroupCreateParams = {
  resource: 'group';
  operation: 'create';
/**
 * The name of the group to create
 */
    name: string | Expression<string>;
/**
 * Whether to allow this group to access all collections within the organization, instead of only its associated collections. If set to true, this option overrides any collection assignments.
 * @default false
 */
    accessAll?: boolean | Expression<boolean>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The collections to assign to this group. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getCollections
     * @default []
     */
    collections?: string[];
    /** The external identifier to set to this group
     */
    externalId?: string | Expression<string>;
  };
};

export type BitwardenV1GroupCreateNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1GroupCreateParams> & { credentials?: Credentials };
};
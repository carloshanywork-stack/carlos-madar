/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=member, operation=create
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1MemberCreateParams = {
  resource: 'member';
  operation: 'create';
/**
 * Type
 * @default 2
 */
    type?: 0 | 1 | 2 | 3 | Expression<number>;
/**
 * The email of the member to update
 */
    email?: string | Expression<string>;
/**
 * Access All
 * @default false
 */
    accessAll?: boolean | Expression<boolean>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The collections to assign to this member. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getCollections
     * @default []
     */
    collections?: string[];
    /** The external identifier to set to this member
     */
    externalId?: string | Expression<string>;
  };
};

export type BitwardenV1MemberCreateNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1MemberCreateParams> & { credentials?: Credentials };
};
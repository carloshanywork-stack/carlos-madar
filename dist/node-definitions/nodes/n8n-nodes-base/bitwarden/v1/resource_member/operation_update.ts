/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=member, operation=update
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1MemberUpdateParams = {
  resource: 'member';
  operation: 'update';
/**
 * The identifier of the member
 */
    memberId: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Type
     * @default {}
     */
    type?: 0 | 1 | 2 | 3 | Expression<number>;
    /** The collections to assign to this member. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getCollections
     * @default []
     */
    collections?: string[];
    /** The external identifier to set to this member
     */
    externalId?: string | Expression<string>;
    /** Access All
     * @default false
     */
    accessAll?: boolean | Expression<boolean>;
  };
};

export type BitwardenV1MemberUpdateNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1MemberUpdateParams> & { credentials?: Credentials };
};
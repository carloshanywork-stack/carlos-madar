/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=group, operation=getMembers
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1GroupGetMembersParams = {
  resource: 'group';
  operation: 'getMembers';
/**
 * The identifier of the group
 */
    groupId: string | Expression<string>;
};

export type BitwardenV1GroupGetMembersNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1GroupGetMembersParams> & { credentials?: Credentials };
};
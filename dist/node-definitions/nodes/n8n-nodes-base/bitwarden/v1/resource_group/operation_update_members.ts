/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=group, operation=updateMembers
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1GroupUpdateMembersParams = {
  resource: 'group';
  operation: 'updateMembers';
/**
 * The identifier of the group
 */
    groupId: string | Expression<string>;
/**
 * Comma-separated list of IDs of members to set in a group
 */
    memberIds?: string | Expression<string>;
};

export type BitwardenV1GroupUpdateMembersNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1GroupUpdateMembersParams> & { credentials?: Credentials };
};
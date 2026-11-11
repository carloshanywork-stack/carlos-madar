/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=member, operation=updateGroups
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1MemberUpdateGroupsParams = {
  resource: 'member';
  operation: 'updateGroups';
/**
 * The identifier of the member
 */
    memberId: string | Expression<string>;
/**
 * Comma-separated list of IDs of groups to set for a member
 */
    groupIds?: string | Expression<string>;
};

export type BitwardenV1MemberUpdateGroupsNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1MemberUpdateGroupsParams> & { credentials?: Credentials };
};
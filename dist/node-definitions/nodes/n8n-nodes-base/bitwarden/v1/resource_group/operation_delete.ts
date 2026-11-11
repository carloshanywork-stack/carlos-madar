/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=group, operation=delete
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1GroupDeleteParams = {
  resource: 'group';
  operation: 'delete';
/**
 * The identifier of the group
 */
    groupId: string | Expression<string>;
};

export type BitwardenV1GroupDeleteNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1GroupDeleteParams> & { credentials?: Credentials };
};
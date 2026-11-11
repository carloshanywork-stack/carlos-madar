/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=group, operation=get
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1GroupGetParams = {
  resource: 'group';
  operation: 'get';
/**
 * The identifier of the group
 */
    groupId: string | Expression<string>;
};

export type BitwardenV1GroupGetNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1GroupGetParams> & { credentials?: Credentials };
};
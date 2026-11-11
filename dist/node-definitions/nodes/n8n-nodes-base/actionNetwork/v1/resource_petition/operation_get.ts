/**
 * Action Network Node - Version 1
 * Discriminator: resource=petition, operation=get
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1PetitionGetParams = {
  resource: 'petition';
  operation: 'get';
/**
 * ID of the petition to retrieve
 */
    petitionId: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
};

export type ActionNetworkV1PetitionGetNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1PetitionGetParams> & { credentials?: Credentials };
};
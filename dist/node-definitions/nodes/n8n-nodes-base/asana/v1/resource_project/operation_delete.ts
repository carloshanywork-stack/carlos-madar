/**
 * Asana Node - Version 1
 * Discriminator: resource=project, operation=delete
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Delete a task */
export type AsanaV1ProjectDeleteParams = {
  resource: 'project';
  operation: 'delete';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Project ID
 */
    id: string | Expression<string>;
};

export type AsanaV1ProjectDeleteNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1ProjectDeleteParams> & { credentials?: Credentials };
};
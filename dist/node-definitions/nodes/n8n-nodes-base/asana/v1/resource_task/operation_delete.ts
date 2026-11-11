/**
 * Asana Node - Version 1
 * Discriminator: resource=task, operation=delete
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Delete a task */
export type AsanaV1TaskDeleteParams = {
  resource: 'task';
  operation: 'delete';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The ID of the task to delete
 */
    id: string | Expression<string>;
};

export type AsanaV1TaskDeleteNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskDeleteParams> & { credentials?: Credentials };
};
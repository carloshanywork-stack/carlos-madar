/**
 * ClickUp Node - Version 1
 * Discriminator: resource=taskList, operation=remove
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Remove a tag from a task */
export type ClickUpV1TaskListRemoveParams = {
  resource: 'taskList';
  operation: 'remove';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Task ID
 */
    taskId: string | Expression<string>;
/**
 * List ID
 */
    listId: string | Expression<string>;
};

export type ClickUpV1TaskListRemoveNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TaskListRemoveParams> & { credentials?: Credentials };
};
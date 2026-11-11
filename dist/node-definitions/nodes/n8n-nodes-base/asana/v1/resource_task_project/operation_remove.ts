/**
 * Asana Node - Version 1
 * Discriminator: resource=taskProject, operation=remove
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Remove a comment from a task */
export type AsanaV1TaskProjectRemoveParams = {
  resource: 'taskProject';
  operation: 'remove';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The ID of the task to add the project to
 */
    id: string | Expression<string>;
/**
 * The project where the task will be removed from. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getProjects
 */
    project: string | Expression<string>;
};

export type AsanaV1TaskProjectRemoveNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskProjectRemoveParams> & { credentials?: Credentials };
};
/**
 * Clockify Node - Version 1
 * Discriminator: resource=task, operation=delete
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Delete a client */
export type ClockifyV1TaskDeleteParams = {
  resource: 'task';
  operation: 'delete';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod loadProjectsForWorkspace
 */
    projectId: string | Expression<string>;
/**
 * ID of task to delete
 */
    taskId: string | Expression<string>;
};

export type ClockifyV1TaskDeleteNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1TaskDeleteParams> & { credentials?: Credentials };
};
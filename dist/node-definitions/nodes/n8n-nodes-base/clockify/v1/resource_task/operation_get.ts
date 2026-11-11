/**
 * Clockify Node - Version 1
 * Discriminator: resource=task, operation=get
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Get a client */
export type ClockifyV1TaskGetParams = {
  resource: 'task';
  operation: 'get';
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
 * ID of task to get
 */
    taskId: string | Expression<string>;
};

export type ClockifyV1TaskGetNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1TaskGetParams> & { credentials?: Credentials };
};
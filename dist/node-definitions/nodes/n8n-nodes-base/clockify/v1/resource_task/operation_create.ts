/**
 * Clockify Node - Version 1
 * Discriminator: resource=task, operation=create
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Create a client */
export type ClockifyV1TaskCreateParams = {
  resource: 'task';
  operation: 'create';
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
 * Name of task to create
 */
    name: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod loadUsersForWorkspace
     * @default []
     */
    assigneeIds?: string[];
    /** Estimate time the task will take, e.x: 2:30 (2 hours and 30 minutes)
     */
    estimate?: string | Expression<string>;
  };
};

export type ClockifyV1TaskCreateNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1TaskCreateParams> & { credentials?: Credentials };
};
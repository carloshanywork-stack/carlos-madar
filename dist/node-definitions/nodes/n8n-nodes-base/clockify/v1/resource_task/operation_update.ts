/**
 * Clockify Node - Version 1
 * Discriminator: resource=task, operation=update
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Update a client */
export type ClockifyV1TaskUpdateParams = {
  resource: 'task';
  operation: 'update';
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
 * ID of task to update
 */
    taskId: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod loadUsersForWorkspace
     * @default []
     */
    assigneeIds?: string[];
    /** Estimate time the task will take, e.x: 2:30 (2 hours and 30 minutes)
     */
    estimate?: string | Expression<string>;
    /** Name
     */
    name?: string | Expression<string>;
    /** Status
     * @default ACTIVE
     */
    status?: 'ACTIVE' | 'DONE' | Expression<string>;
  };
};

export type ClockifyV1TaskUpdateNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1TaskUpdateParams> & { credentials?: Credentials };
};
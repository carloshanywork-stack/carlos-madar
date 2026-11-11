/**
 * Clockify Node - Version 1
 * Discriminator: resource=task, operation=getAll
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Get many clients */
export type ClockifyV1TaskGetAllParams = {
  resource: 'task';
  operation: 'getAll';
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
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Filters
 * @default {}
 */
    filters?: {
    /** Is Active
     * @default false
     */
    'is-active'?: boolean | Expression<boolean>;
    /** Text to match in the task name
     */
    name?: string | Expression<string>;
    /** Sort Column
     * @default NAME
     */
    'sort-column'?: 'NAME' | Expression<string>;
    /** Sort Order
     * @default ASCENDING
     */
    'sort-order'?: 'ASCENDING' | 'DESCENDING' | Expression<string>;
  };
};

export type ClockifyV1TaskGetAllOutput = {
  assigneeId?: null;
  assigneeIds?: Array<string>;
  billable?: boolean;
  costRate?: null;
  id?: string;
  name?: string;
  projectId?: string;
  status?: string;
  userGroupIds?: Array<string>;
};

export type ClockifyV1TaskGetAllNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1TaskGetAllParams> & { credentials?: Credentials };
  output?: Items<ClockifyV1TaskGetAllOutput>;
};
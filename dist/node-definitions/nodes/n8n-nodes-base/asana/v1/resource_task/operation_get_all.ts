/**
 * Asana Node - Version 1
 * Discriminator: resource=task, operation=getAll
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Get many subtasks */
export type AsanaV1TaskGetAllParams = {
  resource: 'task';
  operation: 'getAll';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
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
 * Properties to search for
 * @default {}
 */
    filters?: {
    /** The assignee to filter tasks on. Note: If you specify assignee, you must also specify the workspace to filter on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getUsers
     */
    assignee?: string | Expression<string>;
    /** Defines fields to return. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getTaskFields
     * @default ["gid","name","resource_type"]
     */
    opt_fields?: string[];
    /** Whether to provide “pretty” output
     * @default false
     */
    opt_pretty?: boolean | Expression<boolean>;
    /** The project to filter tasks on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getProjects
     */
    project?: string | Expression<string>;
    /** The section to filter tasks on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getSections
     */
    section?: string | Expression<string>;
    /** The workspace to filter tasks on. Note: If you specify workspace, you must also specify the assignee to filter on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getWorkspaces
     */
    workspace?: string | Expression<string>;
    /** Only return tasks that are either incomplete or that have been completed since this time
     */
    completed_since?: string | Expression<string>;
    /** Only return tasks that have been modified since the given time
     */
    modified_since?: string | Expression<string>;
  };
};

export type AsanaV1TaskGetAllOutput = {
  completed?: boolean;
  gid?: string;
  name?: string;
  resource_subtype?: string;
  resource_type?: string;
};

export type AsanaV1TaskGetAllNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskGetAllParams> & { credentials?: Credentials };
  output?: Items<AsanaV1TaskGetAllOutput>;
};
/**
 * Asana Node - Version 1
 * Discriminator: resource=task, operation=create
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Create a subtask */
export type AsanaV1TaskCreateParams = {
  resource: 'task';
  operation: 'create';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The workspace to create the task in. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getWorkspaces
 */
    workspace: string | Expression<string>;
/**
 * The name of the task to create
 */
    name: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    otherProperties?: {
    /** Set Assignee on the task. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getUsers
     */
    assignee?: string | Expression<string>;
    /** Set Assignee status on the task (requires Assignee)
     * @default inbox
     */
    assignee_status?: 'inbox' | 'today' | 'upcoming' | 'later' | Expression<string>;
    /** Whether the task should be marked completed
     * @default false
     */
    completed?: boolean | Expression<boolean>;
    /** Date on which the time is due
     */
    due_on?: string | Expression<string>;
    /** Whether the task is liked by the authorized user
     * @default false
     */
    liked?: boolean | Expression<boolean>;
    /** The task notes
     */
    notes?: string | Expression<string>;
    /** The project to filter tasks on. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getProjects
     * @default []
     */
    projects?: string[];
  };
};

export type AsanaV1TaskCreateOutput = {
  actual_time_minutes?: number;
  assignee_status?: string;
  completed?: boolean;
  created_at?: string;
  custom_fields?: Array<{
    created_by?: {
      gid?: string;
      name?: string;
      resource_type?: string;
    };
    enabled?: boolean;
    enum_options?: Array<{
      color?: string;
      enabled?: boolean;
      gid?: string;
      name?: string;
      resource_type?: string;
    }>;
    enum_value?: null;
    gid?: string;
    is_formula_field?: boolean;
    name?: string;
    resource_subtype?: string;
    resource_type?: string;
    type?: string;
  }>;
  due_at?: null;
  followers?: Array<{
    gid?: string;
    name?: string;
    resource_type?: string;
  }>;
  gid?: string;
  hearted?: boolean;
  hearts?: Array<{
    gid?: string;
    resource_type?: string;
    user?: {
      gid?: string;
      name?: string;
      resource_type?: string;
    };
  }>;
  liked?: boolean;
  likes?: Array<{
    gid?: string;
    resource_type?: string;
    user?: {
      gid?: string;
      name?: string;
      resource_type?: string;
    };
  }>;
  memberships?: Array<{
    project?: {
      gid?: string;
      name?: string;
      resource_type?: string;
    };
    section?: {
      gid?: string;
      name?: string;
      resource_type?: string;
    };
  }>;
  modified_at?: string;
  name?: string;
  notes?: string;
  num_hearts?: number;
  num_likes?: number;
  parent?: null;
  permalink_url?: string;
  projects?: Array<{
    gid?: string;
    name?: string;
    resource_type?: string;
  }>;
  resource_subtype?: string;
  resource_type?: string;
  start_at?: null;
  start_on?: null;
  workspace?: {
    gid?: string;
    name?: string;
    resource_type?: string;
  };
};

export type AsanaV1TaskCreateNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskCreateParams> & { credentials?: Credentials };
  output?: Items<AsanaV1TaskCreateOutput>;
};
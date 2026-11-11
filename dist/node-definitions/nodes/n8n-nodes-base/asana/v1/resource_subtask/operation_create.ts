/**
 * Asana Node - Version 1
 * Discriminator: resource=subtask, operation=create
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Create a subtask */
export type AsanaV1SubtaskCreateParams = {
  resource: 'subtask';
  operation: 'create';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The task to operate on
 */
    taskId: string | Expression<string>;
/**
 * The name of the subtask to create
 */
    name: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    otherProperties?: {
    /** Set Assignee on the subtask. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getUsers
     */
    assignee?: string | Expression<string>;
    /** Set Assignee status on the subtask (requires Assignee)
     * @default inbox
     */
    assignee_status?: 'inbox' | 'today' | 'upcoming' | 'later' | Expression<string>;
    /** Whether the subtask should be marked completed
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
    /** The workspace to create the subtask in. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getWorkspaces
     */
    workspace?: string | Expression<string>;
  };
};

export type AsanaV1SubtaskCreateOutput = {
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
    number_value?: null;
    precision?: number;
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
  liked?: boolean;
  modified_at?: string;
  name?: string;
  notes?: string;
  num_hearts?: number;
  num_likes?: number;
  parent?: {
    gid?: string;
    name?: string;
    resource_subtype?: string;
    resource_type?: string;
  };
  permalink_url?: string;
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

export type AsanaV1SubtaskCreateNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1SubtaskCreateParams> & { credentials?: Credentials };
  output?: Items<AsanaV1SubtaskCreateOutput>;
};
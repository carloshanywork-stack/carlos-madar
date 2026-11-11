/**
 * ClickUp Node - Version 1
 * Discriminator: resource=task, operation=getAll
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get many comments */
export type ClickUpV1TaskGetAllParams = {
  resource: 'task';
  operation: 'getAll';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTeams
 */
    team: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getSpaces
 */
    space: string | Expression<string>;
/**
 * Folderless List
 * @default false
 */
    folderless?: boolean | Expression<boolean>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getFolders
 * @displayOptions.show { folderless: [false] }
 * @required when the displayOptions conditions above match
 */
    folder?: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getFolderlessLists
 * @displayOptions.show { folderless: [true] }
 * @required when the displayOptions conditions above match
 */
    list?: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default true
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 50
 */
    limit?: number | Expression<number>;
/**
 * Filters
 * @default {}
 */
    filters?: {
    /** Archived
     * @default false
     */
    archived?: boolean | Expression<boolean>;
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getAssignees
     * @default []
     */
    assignees?: string[];
    /** Filter by custom fields
     * @default {}
     */
    customFieldsUi?: {
        /** Custom Field
     */
    customFieldsValues?: Array<{
      /** The ID of the field to add custom field to. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
       * @loadOptionsMethod getCustomFields
       */
      fieldId?: string | Expression<string>;
      /** The value to set on custom field
       * @default equal
       */
      operator?: '!=' | '<' | '<=' | '>' | '>=' | 'equal' | 'IS NOT NULL' | 'IS NULL' | Expression<string>;
      /** The value to set on custom field
       * @displayOptions.hide { operator: ["IS NULL", "IS NOT NULL"] }
       */
      value?: string | Expression<string>;
    }>;
  };
    /** Filter date created greater
     */
    dateCreatedGt?: string | Expression<string>;
    /** Filter date created less than posix time
     */
    dateCreatedLt?: string | Expression<string>;
    /** Filter date updated greater than
     */
    dateUpdatedGt?: string | Expression<string>;
    /** Filter date updated less than
     */
    dateUpdatedLt?: string | Expression<string>;
    /** Filter due date greater than
     */
    dueDateGt?: string | Expression<string>;
    /** Filter due date less than
     */
    dueDateLt?: string | Expression<string>;
    /** The response does by default not include closed tasks. Set this to true and dont send a status filter to include closed tasks.
     * @default false
     */
    includeClosed?: boolean | Expression<boolean>;
    /** Order By
     */
    orderBy?: 'id' | 'created' | 'updated' | 'dueDate' | Expression<string>;
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getStatuses
     * @default []
     */
    statuses?: string[];
    /** Whether to include subtasks, default false
     * @default false
     */
    subtasks?: boolean | Expression<boolean>;
    /** The array of tags applied to this task. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getTags
     * @default []
     */
    tags?: string[];
  };
};

export type ClickUpV1TaskGetAllOutput = {
  archived?: boolean;
  assignees?: Array<{
    email?: string;
    id?: number;
    initials?: string;
    username?: string;
  }>;
  checklists?: Array<{
    creator?: number;
    date_created?: string;
    id?: string;
    items?: Array<{
      assignee?: null;
      date_created?: string;
      due_date?: null;
      due_date_time?: boolean;
      group_assignee?: null;
      id?: string;
      name?: string;
      orderindex?: number;
      parent?: null;
      resolved?: boolean;
      sent_due_date_notif?: null;
      start_date?: null;
      start_date_time?: boolean;
    }>;
    name?: string;
    orderindex?: number;
    resolved?: number;
    task_id?: string;
    unresolved?: number;
  }>;
  creator?: {
    email?: string;
    id?: number;
    username?: string;
  };
  custom_fields?: Array<{
    date_created?: string;
    hide_from_guests?: boolean;
    id?: string;
    name?: string;
    required?: boolean;
    type?: string;
    type_config?: {
      new_drop_down?: boolean;
      number_format?: string;
      options?: Array<{
        id?: string;
        name?: string;
        orderindex?: number;
      }>;
      sorting?: string;
    };
  }>;
  custom_item_id?: number;
  date_created?: string;
  date_updated?: string;
  dependencies?: Array<{
    chain_id?: string;
    date_created?: string;
    depends_on?: string;
    lag_ms?: null;
    task_id?: string;
    type?: number;
    userid?: string;
    workspace_id?: string;
  }>;
  description?: string;
  folder?: {
    access?: boolean;
    hidden?: boolean;
    id?: string;
    name?: string;
  };
  group_assignees?: Array<{
    color?: null;
    email?: string;
    id?: string;
    initials?: string;
    name?: string;
  }>;
  id?: string;
  linked_tasks?: Array<{
    date_created?: string;
    link_id?: string;
    task_id?: string;
    userid?: string;
    workspace_id?: string;
  }>;
  list?: {
    access?: boolean;
    id?: string;
    name?: string;
  };
  locations?: Array<{
    id?: string;
    name?: string;
  }>;
  name?: string;
  orderindex?: string;
  permission_level?: string;
  points?: null;
  project?: {
    access?: boolean;
    hidden?: boolean;
    id?: string;
    name?: string;
  };
  sharing?: {
    public?: boolean;
    public_fields?: Array<string>;
    public_share_expires_on?: null;
    seo_optimized?: boolean;
    token?: null;
  };
  space?: {
    id?: string;
  };
  status?: {
    color?: string;
    id?: string;
    orderindex?: number;
    status?: string;
    type?: string;
  };
  tags?: Array<{
    creator?: number;
    name?: string;
    tag_bg?: string;
    tag_fg?: string;
  }>;
  team_id?: string;
  text_content?: string;
  url?: string;
  watchers?: Array<{
    email?: string;
    id?: number;
    initials?: string;
    username?: string;
  }>;
};

export type ClickUpV1TaskGetAllNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TaskGetAllParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1TaskGetAllOutput>;
};
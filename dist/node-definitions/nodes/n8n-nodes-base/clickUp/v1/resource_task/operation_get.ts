/**
 * ClickUp Node - Version 1
 * Discriminator: resource=task, operation=get
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get a folder */
export type ClickUpV1TaskGetParams = {
  resource: 'task';
  operation: 'get';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Task ID
 */
    id: string | Expression<string>;
/**
 * Whether to also fetch and include subtasks for this task
 * @default false
 */
    includeSubtasks?: boolean | Expression<boolean>;
/**
 * Whether to include the markdown_description field in the response. This is important for preserving links in the description.
 * @default false
 */
    includeMarkdownDescription?: boolean | Expression<boolean>;
};

export type ClickUpV1TaskGetOutput = {
  archived?: boolean;
  assignees?: Array<{
    color?: string;
    email?: string;
    id?: number;
    initials?: string;
    username?: string;
  }>;
  attachments?: Array<{
    date?: string;
    deleted?: boolean;
    email_data?: null;
    extension?: string;
    hidden?: boolean;
    id?: string;
    is_folder?: null;
    mimetype?: string;
    orientation?: null;
    parent_id?: string;
    resolved_comments?: number;
    size?: number;
    source?: number;
    title?: string;
    total_comments?: number;
    type?: number;
    url?: string;
    url_w_host?: string;
    url_w_query?: string;
    user?: {
      color?: string;
      email?: string;
      id?: number;
      initials?: string;
      username?: string;
    };
    version?: number;
    workspace_id?: null;
  }>;
  checklists?: Array<{
    creator?: number;
    date_created?: string;
    id?: string;
    items?: Array<{
      assignee?: null;
      date_created?: string;
      due_date?: null;
      due_date_time?: null;
      group_assignee?: null;
      id?: string;
      name?: string;
      orderindex?: number;
      parent?: null;
      resolved?: boolean;
      sent_due_date_notif?: boolean;
      start_date?: null;
      start_date_time?: null;
    }>;
    name?: string;
    orderindex?: number;
    resolved?: number;
    task_id?: string;
    unresolved?: number;
  }>;
  creator?: {
    color?: string;
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
      field_inverted_name?: string;
      fields?: Array<{
        field?: string;
        hidden?: boolean;
        name?: string;
        orderindex?: number;
        relationship?: string;
        width?: number;
      }>;
      include_guests?: boolean;
      include_team_members?: boolean;
      linked_subcategory_access?: boolean;
      new_drop_down?: boolean;
      number_format?: string;
      options?: Array<{
        id?: string;
        label?: string;
        name?: string;
        orderindex?: number;
      }>;
      single_user?: boolean;
      sorting?: string;
      subcategory_id?: string;
      subcategory_inverted_name?: string;
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
  time_spent?: number;
  url?: string;
  watchers?: Array<{
    email?: string;
    id?: number;
    initials?: string;
    username?: string;
  }>;
};

export type ClickUpV1TaskGetNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TaskGetParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1TaskGetOutput>;
};
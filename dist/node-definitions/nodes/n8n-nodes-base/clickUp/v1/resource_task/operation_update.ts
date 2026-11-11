/**
 * ClickUp Node - Version 1
 * Discriminator: resource=task, operation=update
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Update a checklist */
export type ClickUpV1TaskUpdateParams = {
  resource: 'task';
  operation: 'update';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Task ID
 */
    id: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Assignees IDs. Multiple ca be added separated by comma.
     */
    addAssignees?: string | Expression<string>;
    /** Content
     */
    content?: string | Expression<string>;
    /** Due Date
     */
    dueDate?: string | Expression<string>;
    /** Due Date Time
     * @default false
     */
    dueDateTime?: boolean | Expression<boolean>;
    /** Is Markdown Content
     * @default false
     */
    markdownContent?: boolean | Expression<boolean>;
    /** Name
     */
    name?: string | Expression<string>;
    /** Notify All
     * @default false
     */
    notifyAll?: boolean | Expression<boolean>;
    /** Parent ID
     */
    parentId?: string | Expression<string>;
    /** Integer mapping as 1 : Urgent, 2 : High, 3 : Normal, 4 : Low
     * @default 3
     */
    priority?: number | Expression<number>;
    /** Assignees IDs. Multiple ca be added separated by comma.
     */
    removeAssignees?: string | Expression<string>;
    /** Status
     */
    status?: string | Expression<string>;
    /** Start Date
     */
    startDate?: string | Expression<string>;
    /** Start Date Time
     * @default false
     */
    startDateTime?: boolean | Expression<boolean>;
    /** Time estimate in minutes
     * @default 1
     */
    timeEstimate?: number | Expression<number>;
  };
};

export type ClickUpV1TaskUpdateOutput = {
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
      date_created?: string;
      due_date?: null;
      group_assignee?: null;
      id?: string;
      name?: string;
      parent?: null;
      resolved?: boolean;
      sent_due_date_notif?: null;
      start_date?: null;
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
    type?: string;
    type_config?: {
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
    chain_id?: null;
    date_created?: string;
    depends_on?: string;
    task_id?: string;
    type?: number;
    userid?: string;
    workspace_id?: string;
  }>;
  folder?: {
    access?: boolean;
    id?: string;
    name?: string;
  };
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
  project?: {
    access?: boolean;
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
    name?: string;
    tag_bg?: string;
    tag_fg?: string;
  }>;
  team_id?: string;
  time_spent?: number;
  url?: string;
  watchers?: Array<{
    email?: string;
    id?: number;
    initials?: string;
    username?: string;
  }>;
};

export type ClickUpV1TaskUpdateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TaskUpdateParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1TaskUpdateOutput>;
};
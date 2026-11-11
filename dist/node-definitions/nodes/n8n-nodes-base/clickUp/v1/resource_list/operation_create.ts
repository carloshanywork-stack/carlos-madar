/**
 * ClickUp Node - Version 1
 * Discriminator: resource=list, operation=create
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Create a checklist */
export type ClickUpV1ListCreateParams = {
  resource: 'list';
  operation: 'create';
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
 * Name
 */
    name: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Assignee
     */
    assignee?: string | Expression<string>;
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
    /** Integer mapping as 1 : Urgent, 2 : High, 3 : Normal, 4 : Low
     * @default 3
     */
    priority?: number | Expression<number>;
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getStatuses
     */
    status?: string | Expression<string>;
  };
};

export type ClickUpV1ListCreateOutput = {
  archived?: boolean;
  assignee?: null;
  content?: string;
  deleted?: boolean;
  folder?: {
    access?: boolean;
    hidden?: boolean;
    id?: string;
    name?: string;
  };
  id?: string;
  inbound_address?: string;
  name?: string;
  orderindex?: number;
  override_statuses?: boolean;
  permission_level?: string;
  space?: {
    access?: boolean;
    id?: string;
    name?: string;
  };
  start_date?: null;
  statuses?: Array<{
    color?: string;
    id?: string;
    orderindex?: number;
    status?: string;
    status_group?: string;
    type?: string;
  }>;
};

export type ClickUpV1ListCreateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ListCreateParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1ListCreateOutput>;
};
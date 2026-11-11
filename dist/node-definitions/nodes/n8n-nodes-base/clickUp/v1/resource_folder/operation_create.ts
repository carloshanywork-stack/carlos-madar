/**
 * ClickUp Node - Version 1
 * Discriminator: resource=folder, operation=create
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Create a checklist */
export type ClickUpV1FolderCreateParams = {
  resource: 'folder';
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
 * Name
 */
    name: string | Expression<string>;
};

export type ClickUpV1FolderCreateOutput = {
  archived?: boolean;
  deleted?: boolean;
  hidden?: boolean;
  id?: string;
  lists?: Array<{
    archived?: boolean;
    assignee?: null;
    content?: string;
    due_date?: null;
    id?: string;
    name?: string;
    orderindex?: number;
    override_statuses?: boolean;
    permission_level?: string;
    priority?: null;
    start_date?: null;
    status?: null;
    statuses?: Array<{
      color?: string;
      id?: string;
      orderindex?: number;
      status?: string;
      status_group?: string;
      type?: string;
    }>;
    task_count?: number;
  }>;
  name?: string;
  orderindex?: number;
  override_statuses?: boolean;
  permission_level?: string;
  space?: {
    access?: boolean;
    id?: string;
    name?: string;
  };
  task_count?: string;
};

export type ClickUpV1FolderCreateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1FolderCreateParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1FolderCreateOutput>;
};
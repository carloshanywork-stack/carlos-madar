/**
 * ClickUp Node - Version 1
 * Discriminator: resource=folder, operation=get
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get a folder */
export type ClickUpV1FolderGetParams = {
  resource: 'folder';
  operation: 'get';
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
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getFolders
 */
    folder: string | Expression<string>;
};

export type ClickUpV1FolderGetOutput = {
  archived?: boolean;
  hidden?: boolean;
  id?: string;
  lists?: Array<{
    archived?: boolean;
    content?: string;
    id?: string;
    name?: string;
    orderindex?: number;
    permission_level?: string;
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
  statuses?: Array<{
    color?: string;
    id?: string;
    orderindex?: number;
    status?: string;
    type?: string;
  }>;
  task_count?: string;
};

export type ClickUpV1FolderGetNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1FolderGetParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1FolderGetOutput>;
};
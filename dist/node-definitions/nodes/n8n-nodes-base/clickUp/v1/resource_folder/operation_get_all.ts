/**
 * ClickUp Node - Version 1
 * Discriminator: resource=folder, operation=getAll
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get many comments */
export type ClickUpV1FolderGetAllParams = {
  resource: 'folder';
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
 * Max number of results to return
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
  };
};

export type ClickUpV1FolderGetAllOutput = {
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
      status_group?: string;
      type?: string;
    }>;
    task_count?: number;
  }>;
  name?: string;
  permission_level?: string;
  space?: {
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

export type ClickUpV1FolderGetAllNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1FolderGetAllParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1FolderGetAllOutput>;
};
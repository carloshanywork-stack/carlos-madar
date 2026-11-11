/**
 * ClickUp Node - Version 1
 * Discriminator: resource=list, operation=getAll
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get many comments */
export type ClickUpV1ListGetAllParams = {
  resource: 'list';
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

export type ClickUpV1ListGetAllOutput = {
  archived?: boolean;
  content?: string;
  folder?: {
    access?: boolean;
    id?: string;
    name?: string;
  };
  id?: string;
  name?: string;
  permission_level?: string;
  space?: {
    access?: boolean;
    id?: string;
    name?: string;
  };
  task_count?: number;
};

export type ClickUpV1ListGetAllNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ListGetAllParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1ListGetAllOutput>;
};
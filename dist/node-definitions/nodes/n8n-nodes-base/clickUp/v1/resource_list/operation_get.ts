/**
 * ClickUp Node - Version 1
 * Discriminator: resource=list, operation=get
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get a folder */
export type ClickUpV1ListGetParams = {
  resource: 'list';
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
 * List ID
 */
    list: string | Expression<string>;
};

export type ClickUpV1ListGetOutput = {
  archived?: boolean;
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
  permission_level?: string;
  priority?: null;
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
};

export type ClickUpV1ListGetNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ListGetParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1ListGetOutput>;
};
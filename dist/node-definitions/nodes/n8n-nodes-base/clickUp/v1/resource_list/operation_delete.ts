/**
 * ClickUp Node - Version 1
 * Discriminator: resource=list, operation=delete
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Delete a checklist */
export type ClickUpV1ListDeleteParams = {
  resource: 'list';
  operation: 'delete';
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

export type ClickUpV1ListDeleteNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ListDeleteParams> & { credentials?: Credentials };
};
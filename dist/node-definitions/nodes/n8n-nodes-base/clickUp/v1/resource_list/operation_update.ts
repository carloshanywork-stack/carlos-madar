/**
 * ClickUp Node - Version 1
 * Discriminator: resource=list, operation=update
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Update a checklist */
export type ClickUpV1ListUpdateParams = {
  resource: 'list';
  operation: 'update';
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
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getAssignees
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
    /** Name
     */
    name?: string | Expression<string>;
    /** Integer mapping as 1 : Urgent, 2 : High, 3 : Normal, 4 : Low
     * @default 3
     */
    priority?: number | Expression<number>;
    /** Unset Status
     * @default false
     */
    unsetStatus?: boolean | Expression<boolean>;
  };
};

export type ClickUpV1ListUpdateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ListUpdateParams> & { credentials?: Credentials };
};
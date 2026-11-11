/**
 * ClickUp Node - Version 1
 * Discriminator: resource=timeEntry, operation=update
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Update a checklist */
export type ClickUpV1TimeEntryUpdateParams = {
  resource: 'timeEntry';
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
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getFolderlessLists
 * @displayOptions.show { folderless: [true] }
 * @required when the displayOptions conditions above match
 */
    list?: string | Expression<string>;
/**
 * Archived
 * @default false
 */
    archived?: boolean | Expression<boolean>;
/**
 * Time Entry ID
 */
    timeEntry: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getAssignees
     * @default []
     */
    assignee?: string | Expression<string>;
    /** Billable
     * @default true
     */
    billable?: boolean | Expression<boolean>;
    /** Description of the time entry
     */
    description?: string | Expression<string>;
    /** Duration in minutes
     * @default 0
     */
    duration?: number | Expression<number>;
    /** Start
     */
    start?: string | Expression<string>;
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getTags
     * @default []
     */
    tags?: string[];
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getTasks
     */
    task?: string | Expression<string>;
  };
};

export type ClickUpV1TimeEntryUpdateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TimeEntryUpdateParams> & { credentials?: Credentials };
};
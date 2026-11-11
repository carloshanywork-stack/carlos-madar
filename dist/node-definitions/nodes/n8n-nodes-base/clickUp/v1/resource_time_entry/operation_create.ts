/**
 * ClickUp Node - Version 1
 * Discriminator: resource=timeEntry, operation=create
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Create a checklist */
export type ClickUpV1TimeEntryCreateParams = {
  resource: 'timeEntry';
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
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getFolderlessLists
 * @displayOptions.show { folderless: [true] }
 * @required when the displayOptions conditions above match
 */
    list?: string | Expression<string>;
/**
 * Start
 */
    start: string | Expression<string>;
/**
 * Duration in minutes
 * @default 0
 */
    duration?: number | Expression<number>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTasks
 */
    task?: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
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
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getTimeEntryTags
     * @default []
     */
    tags?: string[];
  };
};

export type ClickUpV1TimeEntryCreateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TimeEntryCreateParams> & { credentials?: Credentials };
};
/**
 * Clockify Node - Version 1
 * Discriminator: resource=timeEntry, operation=update
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Update a client */
export type ClockifyV1TimeEntryUpdateParams = {
  resource: 'timeEntry';
  operation: 'update';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
/**
 * Time Entry ID
 */
    timeEntryId: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Billable
     * @default false
     */
    billable?: boolean | Expression<boolean>;
    /** Filter by custom fields
     * @default {}
     */
    customFieldsUi?: {
        /** Custom Field
     */
    customFieldsValues?: Array<{
      /** The ID of the field to add custom field to. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
       * @loadOptionsMethod loadCustomFieldsForWorkspace
       */
      customFieldId?: string | Expression<string>;
      /** The value to set on custom field
       */
      value?: string | Expression<string>;
    }>;
  };
    /** Description
     */
    description?: string | Expression<string>;
    /** End
     */
    end?: string | Expression<string>;
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod loadProjectsForWorkspace
     */
    projectId?: string | Expression<string>;
    /** Start
     */
    start?: string | Expression<string>;
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod loadTagsForWorkspace
     * @default []
     */
    tagIds?: string[];
    /** Task ID
     */
    taskId?: string | Expression<string>;
  };
};

export type ClockifyV1TimeEntryUpdateNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1TimeEntryUpdateParams> & { credentials?: Credentials };
};
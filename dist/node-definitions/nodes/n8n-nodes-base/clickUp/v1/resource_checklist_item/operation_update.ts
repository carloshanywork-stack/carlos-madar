/**
 * ClickUp Node - Version 1
 * Discriminator: resource=checklistItem, operation=update
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Update a checklist */
export type ClickUpV1ChecklistItemUpdateParams = {
  resource: 'checklistItem';
  operation: 'update';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Checklist ID
 */
    checklist: string | Expression<string>;
/**
 * Checklist Item ID
 */
    checklistItem: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Assignee ID
     */
    assignee?: string | Expression<string>;
    /** Name
     */
    name?: string | Expression<string>;
    /** Checklist item that you want to nest the target checklist item underneath
     */
    parent?: string | Expression<string>;
    /** Resolved
     * @default false
     */
    resolved?: boolean | Expression<boolean>;
  };
};

export type ClickUpV1ChecklistItemUpdateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ChecklistItemUpdateParams> & { credentials?: Credentials };
};
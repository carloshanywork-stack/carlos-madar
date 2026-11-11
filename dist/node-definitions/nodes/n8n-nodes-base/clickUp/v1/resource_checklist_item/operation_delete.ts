/**
 * ClickUp Node - Version 1
 * Discriminator: resource=checklistItem, operation=delete
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Delete a checklist */
export type ClickUpV1ChecklistItemDeleteParams = {
  resource: 'checklistItem';
  operation: 'delete';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Checklist ID
 */
    checklist: string | Expression<string>;
/**
 * Checklist Item ID
 */
    checklistItem: string | Expression<string>;
};

export type ClickUpV1ChecklistItemDeleteNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ChecklistItemDeleteParams> & { credentials?: Credentials };
};
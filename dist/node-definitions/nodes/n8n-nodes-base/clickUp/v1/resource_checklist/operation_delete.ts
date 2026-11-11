/**
 * ClickUp Node - Version 1
 * Discriminator: resource=checklist, operation=delete
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Delete a checklist */
export type ClickUpV1ChecklistDeleteParams = {
  resource: 'checklist';
  operation: 'delete';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Checklist ID
 */
    checklist: string | Expression<string>;
};

export type ClickUpV1ChecklistDeleteNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ChecklistDeleteParams> & { credentials?: Credentials };
};
/**
 * ClickUp Node - Version 1
 * Discriminator: resource=checklist, operation=update
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Update a checklist */
export type ClickUpV1ChecklistUpdateParams = {
  resource: 'checklist';
  operation: 'update';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Checklist ID
 */
    checklist: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Name
     */
    name?: string | Expression<string>;
    /** Position
     * @default 0
     */
    position?: number | Expression<number>;
  };
};

export type ClickUpV1ChecklistUpdateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ChecklistUpdateParams> & { credentials?: Credentials };
};
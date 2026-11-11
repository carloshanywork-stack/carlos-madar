/**
 * ClickUp Node - Version 1
 * Discriminator: resource=goalKeyResult, operation=delete
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Delete a checklist */
export type ClickUpV1GoalKeyResultDeleteParams = {
  resource: 'goalKeyResult';
  operation: 'delete';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Key Result ID
 */
    keyResult: string | Expression<string>;
};

export type ClickUpV1GoalKeyResultDeleteNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1GoalKeyResultDeleteParams> & { credentials?: Credentials };
};
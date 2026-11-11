/**
 * ClickUp Node - Version 1
 * Discriminator: resource=goal, operation=delete
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Delete a checklist */
export type ClickUpV1GoalDeleteParams = {
  resource: 'goal';
  operation: 'delete';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Goal ID
 */
    goal: string | Expression<string>;
};

export type ClickUpV1GoalDeleteNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1GoalDeleteParams> & { credentials?: Credentials };
};
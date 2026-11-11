/**
 * ClickUp Node - Version 1
 * Discriminator: resource=goal, operation=getAll
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get many comments */
export type ClickUpV1GoalGetAllParams = {
  resource: 'goal';
  operation: 'getAll';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTeams
 */
    team: string | Expression<string>;
/**
 * Max number of results to return
 * @default 50
 */
    limit?: number | Expression<number>;
};

export type ClickUpV1GoalGetAllNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1GoalGetAllParams> & { credentials?: Credentials };
};
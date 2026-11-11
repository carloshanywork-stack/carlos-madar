/**
 * ClickUp Node - Version 1
 * Discriminator: resource=goal, operation=create
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Create a checklist */
export type ClickUpV1GoalCreateParams = {
  resource: 'goal';
  operation: 'create';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTeams
 */
    team: string | Expression<string>;
/**
 * Name
 */
    name: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Color
     */
    color?: string | Expression<string>;
    /** Description
     */
    description?: string | Expression<string>;
    /** Due Date
     */
    dueDate?: string | Expression<string>;
    /** Multiple Owners
     * @default false
     */
    multipleOwners?: boolean | Expression<boolean>;
    /** Owners
     */
    owners?: string | Expression<string>;
  };
};

export type ClickUpV1GoalCreateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1GoalCreateParams> & { credentials?: Credentials };
};
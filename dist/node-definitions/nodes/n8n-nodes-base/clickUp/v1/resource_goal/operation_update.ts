/**
 * ClickUp Node - Version 1
 * Discriminator: resource=goal, operation=update
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Update a checklist */
export type ClickUpV1GoalUpdateParams = {
  resource: 'goal';
  operation: 'update';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Goal ID
 */
    goal: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Add Owners
     */
    addOwners?: string | Expression<string>;
    /** Color
     */
    color?: string | Expression<string>;
    /** Description
     */
    description?: string | Expression<string>;
    /** Due Date
     */
    dueDate?: string | Expression<string>;
    /** Name
     */
    name?: string | Expression<string>;
    /** Remove Owners
     */
    removeOwners?: string | Expression<string>;
  };
};

export type ClickUpV1GoalUpdateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1GoalUpdateParams> & { credentials?: Credentials };
};
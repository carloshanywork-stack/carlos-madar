/**
 * ClickUp Node - Version 1
 * Discriminator: resource=goalKeyResult, operation=create
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Create a checklist */
export type ClickUpV1GoalKeyResultCreateParams = {
  resource: 'goalKeyResult';
  operation: 'create';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Goal ID
 */
    goal: string | Expression<string>;
/**
 * Name
 */
    name: string | Expression<string>;
/**
 * Type
 */
    type: 'automatic' | 'boolean' | 'currency' | 'number' | 'percentage' | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** List IDs
     */
    listIds?: string | Expression<string>;
    /** Owners
     */
    owners?: string | Expression<string>;
    /** Required for Percentage, Automatic, Number and Currency
     * @default 0
     */
    stepsStart?: number | Expression<number>;
    /** Required for Percentage, Automatic, Number and Currency
     * @default 0
     */
    stepsEnd?: number | Expression<number>;
    /** Task IDs
     */
    taskIds?: string | Expression<string>;
    /** Only matters for type Number and Currency. For Currency the unit must be a valid currency code.
     */
    unit?: string | Expression<string>;
  };
};

export type ClickUpV1GoalKeyResultCreateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1GoalKeyResultCreateParams> & { credentials?: Credentials };
};
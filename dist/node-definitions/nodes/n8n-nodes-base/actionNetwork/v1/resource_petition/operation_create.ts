/**
 * Action Network Node - Version 1
 * Discriminator: resource=petition, operation=create
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1PetitionCreateParams = {
  resource: 'petition';
  operation: 'create';
/**
 * Source where the petition originated
 */
    originSystem: string | Expression<string>;
/**
 * Title of the petition to create
 */
    title: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** URL to this petition’s page on the Action Network or a third party
     */
    browser_url?: string | Expression<string>;
    /** URL to this action’s featured image on the Action Network
     */
    featured_image_url?: string | Expression<string>;
    /** Internal (not public) title of the petition
     */
    name?: string | Expression<string>;
    /** Text of the letter to the petition’s target
     */
    petition_text?: string | Expression<string>;
    /** Comma-separated names of targets for this petition
     */
    target?: string | Expression<string>;
  };
};

export type ActionNetworkV1PetitionCreateNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1PetitionCreateParams> & { credentials?: Credentials };
};
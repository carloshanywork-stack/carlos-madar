/**
 * ClickUp Node - Version 1
 * Discriminator: resource=spaceTag, operation=create
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Create a checklist */
export type ClickUpV1SpaceTagCreateParams = {
  resource: 'spaceTag';
  operation: 'create';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Space ID
 */
    space: string | Expression<string>;
/**
 * Name
 */
    name: string | Expression<string>;
/**
 * Foreground Color
 * @default #000000
 */
    foregroundColor?: string | Expression<string>;
/**
 * Background Color
 * @default #000000
 */
    backgroundColor?: string | Expression<string>;
};

export type ClickUpV1SpaceTagCreateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1SpaceTagCreateParams> & { credentials?: Credentials };
};
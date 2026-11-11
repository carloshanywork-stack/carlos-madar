/**
 * ClickUp Node - Version 1
 * Discriminator: resource=spaceTag, operation=delete
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Delete a checklist */
export type ClickUpV1SpaceTagDeleteParams = {
  resource: 'spaceTag';
  operation: 'delete';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Space ID
 */
    space: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTags
 */
    name: string | Expression<string>;
};

export type ClickUpV1SpaceTagDeleteNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1SpaceTagDeleteParams> & { credentials?: Credentials };
};
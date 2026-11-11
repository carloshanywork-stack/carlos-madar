/**
 * Asana Node - Version 1
 * Discriminator: resource=taskTag, operation=add
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Add a comment to a task */
export type AsanaV1TaskTagAddParams = {
  resource: 'taskTag';
  operation: 'add';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The ID of the task to add the tag to
 */
    id: string | Expression<string>;
/**
 * The tag that should be added. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTags
 */
    tag: string | Expression<string>;
};

export type AsanaV1TaskTagAddNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskTagAddParams> & { credentials?: Credentials };
};
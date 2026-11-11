/**
 * Asana Node - Version 1
 * Discriminator: resource=taskComment, operation=remove
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Remove a comment from a task */
export type AsanaV1TaskCommentRemoveParams = {
  resource: 'taskComment';
  operation: 'remove';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The ID of the comment to be removed
 */
    id: string | Expression<string>;
};

export type AsanaV1TaskCommentRemoveNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskCommentRemoveParams> & { credentials?: Credentials };
};
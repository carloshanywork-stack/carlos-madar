/**
 * ClickUp Node - Version 1
 * Discriminator: resource=comment, operation=delete
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Delete a checklist */
export type ClickUpV1CommentDeleteParams = {
  resource: 'comment';
  operation: 'delete';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Comment ID
 */
    comment: string | Expression<string>;
};

export type ClickUpV1CommentDeleteNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1CommentDeleteParams> & { credentials?: Credentials };
};
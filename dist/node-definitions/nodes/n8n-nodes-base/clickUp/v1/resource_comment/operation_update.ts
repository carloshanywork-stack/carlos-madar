/**
 * ClickUp Node - Version 1
 * Discriminator: resource=comment, operation=update
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Update a checklist */
export type ClickUpV1CommentUpdateParams = {
  resource: 'comment';
  operation: 'update';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Comment ID
 */
    comment: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Assignee ID
     */
    assignee?: string | Expression<string>;
    /** Comment Text
     */
    commentText?: string | Expression<string>;
    /** Resolved
     * @default false
     */
    resolved?: boolean | Expression<boolean>;
  };
};

export type ClickUpV1CommentUpdateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1CommentUpdateParams> & { credentials?: Credentials };
};
/**
 * ClickUp Node - Version 1
 * Discriminator: resource=comment, operation=create
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Create a checklist */
export type ClickUpV1CommentCreateParams = {
  resource: 'comment';
  operation: 'create';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Comment On
 */
    commentOn?: 'list' | 'task' | 'view' | Expression<string>;
/**
 * ID
 */
    id: string | Expression<string>;
/**
 * Comment Text
 */
    commentText?: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Assignee ID
     */
    assignee?: string | Expression<string>;
    /** Whether creation notifications will be sent to everyone including the creator of the comment
     * @default false
     */
    notifyAll?: boolean | Expression<boolean>;
  };
};

export type ClickUpV1CommentCreateOutput = {
  date?: number;
  hist_id?: string;
  id?: number;
  version?: {
    data?: {
      changes?: Array<{
        after?: number;
        field?: string;
      }>;
      context?: {
        audit_context?: {
          current_time?: number;
          route?: string;
          userid?: number;
        };
        originating_service?: string;
      };
      relationships?: Array<{
        object_type?: string;
        type?: string;
        workspace_id?: string;
      }>;
    };
    date_created?: number;
    date_updated?: number;
    deleted?: boolean;
    event_publish_time?: number;
    master_id?: number;
    object_id?: string;
    object_type?: string;
    operation?: string;
    traceparent?: string;
    version?: number;
    workspace_id?: number;
  };
};

export type ClickUpV1CommentCreateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1CommentCreateParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1CommentCreateOutput>;
};
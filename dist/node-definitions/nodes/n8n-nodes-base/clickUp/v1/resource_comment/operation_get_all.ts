/**
 * ClickUp Node - Version 1
 * Discriminator: resource=comment, operation=getAll
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get many comments */
export type ClickUpV1CommentGetAllParams = {
  resource: 'comment';
  operation: 'getAll';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Comments On
 */
    commentsOn?: 'list' | 'task' | 'view' | Expression<string>;
/**
 * ID
 */
    id: string | Expression<string>;
/**
 * Max number of results to return
 * @default 50
 */
    limit?: number | Expression<number>;
};

export type ClickUpV1CommentGetAllOutput = {
  comment?: Array<{
    attributes?: {
      'block-id'?: string;
    };
    text?: string;
  }>;
  comment_text?: string;
  date?: string;
  group_assignee?: null;
  id?: string;
  reactions?: Array<{
    date?: string;
    reaction?: string;
    user?: {
      email?: string;
      id?: number;
      initials?: string;
      username?: string;
    };
  }>;
  reply_count?: number;
  user?: {
    email?: string;
    id?: number;
    initials?: string;
    username?: string;
  };
};

export type ClickUpV1CommentGetAllNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1CommentGetAllParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1CommentGetAllOutput>;
};
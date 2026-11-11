/**
 * Asana Node - Version 1
 * Discriminator: resource=taskComment, operation=add
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Add a comment to a task */
export type AsanaV1TaskCommentAddParams = {
  resource: 'taskComment';
  operation: 'add';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The ID of the task to add the comment to
 */
    id: string | Expression<string>;
/**
 * Whether body is HTML or simple text
 * @default false
 */
    isTextHtml?: boolean | Expression<boolean>;
/**
 * The plain text of the comment to add
 * @displayOptions.show { isTextHtml: [false] }
 * @required when the displayOptions conditions above match
 */
    text?: string | Expression<string>;
/**
 * Properties of the task comment
 * @default {}
 */
    additionalFields?: {
    /** Whether to pin the comment
     * @default false
     */
    is_pinned?: boolean | Expression<boolean>;
  };
};

export type AsanaV1TaskCommentAddOutput = {
  created_at?: string;
  created_by?: {
    gid?: string;
    name?: string;
    resource_type?: string;
  };
  gid?: string;
  hearted?: boolean;
  is_editable?: boolean;
  is_edited?: boolean;
  is_pinned?: boolean;
  liked?: boolean;
  num_hearts?: number;
  num_likes?: number;
  resource_subtype?: string;
  resource_type?: string;
  source?: string;
  target?: {
    gid?: string;
    name?: string;
    resource_subtype?: string;
    resource_type?: string;
  };
  text?: string;
  type?: string;
};

export type AsanaV1TaskCommentAddNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskCommentAddParams> & { credentials?: Credentials };
  output?: Items<AsanaV1TaskCommentAddOutput>;
};
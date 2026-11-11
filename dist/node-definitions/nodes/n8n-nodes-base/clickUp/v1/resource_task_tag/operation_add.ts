/**
 * ClickUp Node - Version 1
 * Discriminator: resource=taskTag, operation=add
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Add a tag to a task */
export type ClickUpV1TaskTagAddParams = {
  resource: 'taskTag';
  operation: 'add';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Task ID
 */
    taskId: string | Expression<string>;
/**
 * Tag Name
 */
    tagName: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Whether to reference a task by it's custom task ID
     * @default false
     */
    custom_task_ids?: boolean | Expression<boolean>;
    /** Only used when the parameter is set to custom_task_ids=true. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getTeams
     */
    team_id?: string | Expression<string>;
  };
};

export type ClickUpV1TaskTagAddOutput = {
  success?: boolean;
};

export type ClickUpV1TaskTagAddNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TaskTagAddParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1TaskTagAddOutput>;
};
/**
 * Asana Node - Version 1
 * Discriminator: resource=task, operation=move
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Move a task */
export type AsanaV1TaskMoveParams = {
  resource: 'task';
  operation: 'move';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The ID of the task to be moved
 */
    id: string | Expression<string>;
/**
 * Project to show the sections of. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getProjects
 */
    projectId: string | Expression<string>;
/**
 * The Section to move the task to. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getSections
 */
    section: string | Expression<string>;
};

export type AsanaV1TaskMoveOutput = {
  success?: boolean;
};

export type AsanaV1TaskMoveNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskMoveParams> & { credentials?: Credentials };
  output?: Items<AsanaV1TaskMoveOutput>;
};
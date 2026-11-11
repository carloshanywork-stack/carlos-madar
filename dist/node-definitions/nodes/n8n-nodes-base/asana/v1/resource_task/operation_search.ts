/**
 * Asana Node - Version 1
 * Discriminator: resource=task, operation=search
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Search for tasks */
export type AsanaV1TaskSearchParams = {
  resource: 'task';
  operation: 'search';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The workspace in which the task is searched. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getWorkspaces
 */
    workspace: string | Expression<string>;
/**
 * Properties to search for
 * @default {}
 */
    searchTaskProperties?: {
    /** Whether the task is marked completed
     * @default false
     */
    completed?: boolean | Expression<boolean>;
    /** Text to search for in name or notes
     */
    text?: string | Expression<string>;
  };
};

export type AsanaV1TaskSearchOutput = {
  gid?: string;
  name?: string;
  resource_subtype?: string;
  resource_type?: string;
};

export type AsanaV1TaskSearchNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskSearchParams> & { credentials?: Credentials };
  output?: Items<AsanaV1TaskSearchOutput>;
};
/**
 * Asana Node - Version 1
 * Discriminator: resource=user, operation=getAll
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Get many subtasks */
export type AsanaV1UserGetAllParams = {
  resource: 'user';
  operation: 'getAll';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The workspace in which to get users. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getWorkspaces
 */
    workspace: string | Expression<string>;
};

export type AsanaV1UserGetAllOutput = {
  gid?: string;
  name?: string;
  resource_type?: string;
};

export type AsanaV1UserGetAllNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1UserGetAllParams> & { credentials?: Credentials };
  output?: Items<AsanaV1UserGetAllOutput>;
};
/**
 * Asana Node - Version 1
 * Discriminator: resource=project, operation=getAll
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Get many subtasks */
export type AsanaV1ProjectGetAllParams = {
  resource: 'project';
  operation: 'getAll';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The workspace in which to get users. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getWorkspaces
 */
    workspace: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Other properties to set
 * @default {}
 */
    additionalFields?: {
    /** Whether to only return projects whose archived field takes on the value of this parameter
     * @default false
     */
    archived?: boolean | Expression<boolean>;
    /** The new name of the task. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getTeams
     */
    team?: string | Expression<string>;
  };
};

export type AsanaV1ProjectGetAllOutput = {
  gid?: string;
  name?: string;
  resource_subtype?: string;
  resource_type?: string;
};

export type AsanaV1ProjectGetAllNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1ProjectGetAllParams> & { credentials?: Credentials };
  output?: Items<AsanaV1ProjectGetAllOutput>;
};
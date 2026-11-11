/**
 * Asana Node - Version 1
 * Discriminator: resource=project, operation=create
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Create a subtask */
export type AsanaV1ProjectCreateParams = {
  resource: 'project';
  operation: 'create';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The name of the project to create
 */
    name: string | Expression<string>;
/**
 * The workspace to create the project in. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getWorkspaces
 */
    workspace: string | Expression<string>;
/**
 * The team this project will be assigned to. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTeams
 */
    team?: string | Expression<string>;
/**
 * Other properties to set
 * @default {}
 */
    additionalFields?: {
    /** Color of the project
     * @default none
     */
    color?: 'dark-blue' | 'dark-brown' | 'dark-green' | 'dark-orange' | 'dark-pink' | 'dark-purple' | 'dark-red' | 'dark-teal' | 'dark-warm-gray' | 'light-blue' | 'light-green' | 'light-orange' | 'light-pink' | 'light-purple' | 'light-red' | 'light-teal' | 'light-warm-gray' | 'light-yellow' | 'none' | Expression<string>;
    /** The day on which this project is due. This takes a date with format YYYY-MM-DD.
     */
    due_on?: string | Expression<string>;
    /** Basic description or notes for the project
     */
    notes?: string | Expression<string>;
    /** The privacy setting of the project
     * @default private
     */
    privacy_setting?: 'private' | 'private_to_team' | 'public_to_workspace' | Expression<string>;
  };
};

export type AsanaV1ProjectCreateOutput = {
  archived?: boolean;
  completed?: boolean;
  completed_at?: null;
  completed_by?: null;
  created_at?: string;
  current_status?: null;
  current_status_update?: null;
  default_access_level?: string;
  default_view?: string;
  followers?: Array<{
    gid?: string;
    name?: string;
    resource_type?: string;
  }>;
  gid?: string;
  icon?: string;
  members?: Array<{
    gid?: string;
    name?: string;
    resource_type?: string;
  }>;
  minimum_access_level_for_customization?: string;
  minimum_access_level_for_sharing?: string;
  modified_at?: string;
  name?: string;
  notes?: string;
  owner?: {
    gid?: string;
    name?: string;
    resource_type?: string;
  };
  permalink_url?: string;
  privacy_setting?: string;
  public?: boolean;
  resource_type?: string;
  start_on?: null;
  team?: {
    gid?: string;
    name?: string;
    resource_type?: string;
  };
  workspace?: {
    gid?: string;
    name?: string;
    resource_type?: string;
  };
};

export type AsanaV1ProjectCreateNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1ProjectCreateParams> & { credentials?: Credentials };
  output?: Items<AsanaV1ProjectCreateOutput>;
};
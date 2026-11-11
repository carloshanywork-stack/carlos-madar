/**
 * Asana Node - Version 1
 * Discriminator: resource=project, operation=update
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Update a task */
export type AsanaV1ProjectUpdateParams = {
  resource: 'project';
  operation: 'update';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The workspace in which to get users. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getWorkspaces
 */
    workspace: string | Expression<string>;
/**
 * The ID of the project to update the data of
 */
    id: string | Expression<string>;
/**
 * Other properties to set
 * @default {}
 */
    updateFields?: {
    /** Color of the project
     * @default none
     */
    color?: 'dark-blue' | 'dark-brown' | 'dark-green' | 'dark-orange' | 'dark-pink' | 'dark-purple' | 'dark-red' | 'dark-teal' | 'dark-warm-gray' | 'light-blue' | 'light-green' | 'light-orange' | 'light-pink' | 'light-purple' | 'light-red' | 'light-teal' | 'light-warm-gray' | 'light-yellow' | 'none' | Expression<string>;
    /** The day on which this project is due. This takes a date with format YYYY-MM-DD.
     */
    due_on?: string | Expression<string>;
    /** The name of the project
     */
    name?: string | Expression<string>;
    /** Basic description or notes for the project
     */
    notes?: string | Expression<string>;
    /** The new assignee/cardinal for this project
     */
    owner?: string | Expression<string>;
    /** The privacy setting of the project
     * @default private
     */
    privacy_setting?: 'private' | 'private_to_team' | 'public_to_workspace' | Expression<string>;
    /** The team this project will be assigned to. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getTeams
     */
    team?: string | Expression<string>;
  };
};

export type AsanaV1ProjectUpdateNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1ProjectUpdateParams> & { credentials?: Credentials };
};
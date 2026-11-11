/**
 * Asana Node - Version 1
 * Discriminator: resource=taskProject, operation=add
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Add a comment to a task */
export type AsanaV1TaskProjectAddParams = {
  resource: 'taskProject';
  operation: 'add';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The ID of the task to add the project to
 */
    id: string | Expression<string>;
/**
 * The project where the task will be added. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getProjects
 */
    project: string | Expression<string>;
/**
 * Other properties to set
 * @default {}
 */
    additionalFields?: {
    /** A task in the project to insert the task after, or null to insert at the beginning of the list
     */
    insert_after?: string | Expression<string>;
    /** A task in the project to insert the task before, or null to insert at the end of the list
     */
    insert_before?: string | Expression<string>;
    /** A section in the project to insert the task into. The task will be inserted at the bottom of the section.
     */
    section?: string | Expression<string>;
  };
};

export type AsanaV1TaskProjectAddOutput = {
  success?: boolean;
};

export type AsanaV1TaskProjectAddNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskProjectAddParams> & { credentials?: Credentials };
  output?: Items<AsanaV1TaskProjectAddOutput>;
};
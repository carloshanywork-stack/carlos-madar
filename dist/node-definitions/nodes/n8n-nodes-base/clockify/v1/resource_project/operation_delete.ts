/**
 * Clockify Node - Version 1
 * Discriminator: resource=project, operation=delete
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Delete a client */
export type ClockifyV1ProjectDeleteParams = {
  resource: 'project';
  operation: 'delete';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
/**
 * Project ID
 */
    projectId: string | Expression<string>;
};

export type ClockifyV1ProjectDeleteNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1ProjectDeleteParams> & { credentials?: Credentials };
};
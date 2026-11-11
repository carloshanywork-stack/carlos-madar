/**
 * Clockify Node - Version 1
 * Discriminator: resource=client, operation=delete
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Delete a client */
export type ClockifyV1ClientDeleteParams = {
  resource: 'client';
  operation: 'delete';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
/**
 * Client ID
 */
    clientId?: string | Expression<string>;
};

export type ClockifyV1ClientDeleteNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1ClientDeleteParams> & { credentials?: Credentials };
};
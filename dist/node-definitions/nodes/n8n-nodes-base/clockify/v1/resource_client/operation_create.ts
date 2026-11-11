/**
 * Clockify Node - Version 1
 * Discriminator: resource=client, operation=create
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Create a client */
export type ClockifyV1ClientCreateParams = {
  resource: 'client';
  operation: 'create';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
/**
 * Name of client being created
 */
    name: string | Expression<string>;
};

export type ClockifyV1ClientCreateNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1ClientCreateParams> & { credentials?: Credentials };
};
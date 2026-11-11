/**
 * Clockify Node - Version 1
 * Discriminator: resource=client, operation=get
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Get a client */
export type ClockifyV1ClientGetParams = {
  resource: 'client';
  operation: 'get';
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

export type ClockifyV1ClientGetNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1ClientGetParams> & { credentials?: Credentials };
};
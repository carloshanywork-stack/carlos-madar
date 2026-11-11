/**
 * Clockify Node - Version 1
 * Discriminator: resource=tag, operation=create
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Create a client */
export type ClockifyV1TagCreateParams = {
  resource: 'tag';
  operation: 'create';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
/**
 * Name of tag being created
 */
    name: string | Expression<string>;
};

export type ClockifyV1TagCreateNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1TagCreateParams> & { credentials?: Credentials };
};
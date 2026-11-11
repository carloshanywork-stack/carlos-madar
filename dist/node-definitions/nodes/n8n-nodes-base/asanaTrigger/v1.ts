/**
 * Asana Trigger Node - Version 1
 * Starts the workflow when Asana events occur.
 */


export interface AsanaTriggerV1Params {
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The resource ID to subscribe to. The resource can be a task or project.
 */
    resource: string | Expression<string>;
/**
 * The workspace ID the resource is registered under. This is only required if you want to allow overriding existing webhooks. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getWorkspaces
 */
    workspace?: string | Expression<string>;
}

export interface AsanaTriggerV1Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

interface AsanaTriggerV1NodeBase {
  type: 'n8n-nodes-base.asanaTrigger';
  version: 1;
  isTrigger: true;
}

export type AsanaTriggerV1ParamsNode = AsanaTriggerV1NodeBase & {
  config: NodeConfig<AsanaTriggerV1Params> & { credentials?: AsanaTriggerV1Credentials };
};

export type AsanaTriggerV1Node = AsanaTriggerV1ParamsNode;
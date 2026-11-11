/**
 * Bitbucket Trigger Node - Version 1
 * Handle Bitbucket events via webhooks
 */


export interface BitbucketTriggerV1Params {
/**
 * Authentication
 * @default password
 */
    authentication?: 'password' | 'accessToken' | Expression<string>;
  resource?: 'repository' | 'workspace';
/**
 * The repository of which to listen to the events. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getWorkspaces
 * @displayOptions.show { resource: ["workspace", "repository"] }
 * @required when the displayOptions conditions above match
 */
    workspace?: string | Expression<string>;
/**
 * The events to listen to. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getWorkspaceEvents
 * @displayOptions.show { resource: ["workspace"] }
 * @required when the displayOptions conditions above match
 * @default []
 */
    events?: string[];
/**
 * The repository of which to listen to the events. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getRepositories
 * @displayOptions.show { resource: ["repository"] }
 * @required when the displayOptions conditions above match
 */
    repository?: string | Expression<string>;
}

export interface BitbucketTriggerV1Credentials {
  bitbucketApi: CredentialReference;
  bitbucketAccessTokenApi: CredentialReference;
}

interface BitbucketTriggerV1NodeBase {
  type: 'n8n-nodes-base.bitbucketTrigger';
  version: 1;
  isTrigger: true;
}

export type BitbucketTriggerV1ParamsNode = BitbucketTriggerV1NodeBase & {
  config: NodeConfig<BitbucketTriggerV1Params> & { credentials?: BitbucketTriggerV1Credentials };
};

export type BitbucketTriggerV1Node = BitbucketTriggerV1ParamsNode;
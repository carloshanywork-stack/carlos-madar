/**
 * Asana Node - Version 1
 * Discriminator: resource=subtask, operation=getAll
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Get many subtasks */
export type AsanaV1SubtaskGetAllParams = {
  resource: 'subtask';
  operation: 'getAll';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The task to operate on
 */
    taskId: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Defines fields to return. Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getTaskFields
     * @default ["gid","name","resource_type"]
     */
    opt_fields?: string[];
    /** Whether to provide “pretty” output
     * @default false
     */
    opt_pretty?: boolean | Expression<boolean>;
  };
};

export type AsanaV1SubtaskGetAllOutput = {
  gid?: string;
  name?: string;
  resource_subtype?: string;
  resource_type?: string;
};

export type AsanaV1SubtaskGetAllNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1SubtaskGetAllParams> & { credentials?: Credentials };
  output?: Items<AsanaV1SubtaskGetAllOutput>;
};
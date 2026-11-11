/**
 * Airtop Node - Version 1.1
 * Discriminator: resource=file, operation=getMany
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Get details of multiple uploaded files */
export type AirtopV11FileGetManyParams = {
  resource: 'file';
  operation: 'getMany';
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 10
 */
    limit?: number | Expression<number>;
/**
 * Comma-separated list of &lt;a href="https://docs.airtop.ai/api-reference/airtop-api/sessions/create" target="_blank"&gt;Session IDs&lt;/a&gt; to filter files by. When empty, all files from all sessions will be returned.
 */
    sessionIds?: string | Expression<string>;
/**
 * Whether to output one item containing all files or output each file as a separate item
 * @default true
 */
    outputSingleItem?: boolean | Expression<boolean>;
};

export type AirtopV11FileGetManyNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1.1;
  config: NodeConfig<AirtopV11FileGetManyParams> & { credentials?: Credentials };
};
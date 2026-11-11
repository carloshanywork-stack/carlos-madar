/**
 * Azure Cosmos DB Node - Version 1
 * Discriminator: resource=container, operation=get
 */


interface Credentials {
  microsoftAzureCosmosDbSharedKeyApi: CredentialReference;
}

/** Retrieve a container */
export type AzureCosmosDbV1ContainerGetParams = {
  resource: 'container';
  operation: 'get';
/**
 * Select the container you want to retrieve
 * @searchListMethod searchContainers
 * @default {"mode":"list","value":""}
 */
    container?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
  requestOptions?: {
    /** Batching
     * @default {"batch":{}}
     */
    batching?: {
        /** Batching
     */
    batch?: {
      /** Input will be split in batches to throttle requests. -1 for disabled. 0 will be treated as 1.
       * @default 50
       */
      batchSize?: number | Expression<number>;
      /** Time (in milliseconds) between each batch of requests. 0 for disabled.
       * @default 1000
       */
      batchInterval?: number | Expression<number>;
    };
  };
    /** Whether to accept the response even if SSL certificate validation is not possible
     * @default false
     */
    allowUnauthorizedCerts?: boolean;
    /** HTTP proxy to use. If authentication is required it can be defined as follow: http://username:password@myproxy:3128
     */
    proxy?: string | Expression<string>;
    /** Time in ms to wait for the server to send response headers (and start the response body) before aborting the request
     * @default 10000
     */
    timeout?: number | Expression<number>;
  };
};

export type AzureCosmosDbV1ContainerGetNode = {
  type: 'n8n-nodes-base.azureCosmosDb';
  version: 1;
  config: NodeConfig<AzureCosmosDbV1ContainerGetParams> & { credentials?: Credentials };
};
/**
 * Azure Cosmos DB Node - Version 1
 * Discriminator: resource=container, operation=create
 */


interface Credentials {
  microsoftAzureCosmosDbSharedKeyApi: CredentialReference;
}

/** Create a container */
export type AzureCosmosDbV1ContainerCreateParams = {
  resource: 'container';
  operation: 'create';
/**
 * Unique identifier for the new container
 */
    containerCreate: string | Expression<string>;
/**
 * The partition key is used to automatically distribute data across partitions for scalability. Choose a property in your JSON document that has a wide range of values and evenly distributes request volume.
 */
    partitionKey?: IDataObject | string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** This value is used to configure indexing policy
     */
    indexingPolicy?: IDataObject | string | Expression<string>;
    /** The user specified autoscale max RU/s
     * @displayOptions.hide { /additionalFields.offerThroughput: [{"_cnd":{"exists":true}}] }
     * @default 1000
     */
    maxThroughput?: number | Expression<number>;
    /** The user specified manual throughput (RU/s) for the collection expressed in units of 100 request units per second
     * @displayOptions.hide { /additionalFields.maxThroughput: [{"_cnd":{"exists":true}}] }
     * @default 400
     */
    offerThroughput?: number | Expression<number>;
  };
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

export type AzureCosmosDbV1ContainerCreateNode = {
  type: 'n8n-nodes-base.azureCosmosDb';
  version: 1;
  config: NodeConfig<AzureCosmosDbV1ContainerCreateParams> & { credentials?: Credentials };
};
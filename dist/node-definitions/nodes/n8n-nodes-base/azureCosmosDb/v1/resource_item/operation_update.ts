/**
 * Azure Cosmos DB Node - Version 1
 * Discriminator: resource=item, operation=update
 */


interface Credentials {
  microsoftAzureCosmosDbSharedKeyApi: CredentialReference;
}

/** Update an existing item */
export type AzureCosmosDbV1ItemUpdateParams = {
  resource: 'item';
  operation: 'update';
/**
 * Select the container you want to use
 * @searchListMethod searchContainers
 * @default {"mode":"list","value":""}
 */
    container?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * Select the item to be updated
 * @searchListMethod searchItems
 * @displayOptions.hide { container: [""] }
 * @default {"mode":"list","value":""}
 */
    item?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * The item contents as a JSON object
 * @displayOptions.hide { container: [""], item: [""] }
 * @default {}
 */
    customProperties?: IDataObject | string | Expression<string>;
/**
 * Additional Fields
 * @displayOptions.hide { container: [""], item: [""] }
 * @default {}
 */
    additionalFields?: {
    /** Partition Key
     * @hint Only required if a custom partition key is set for the container
     */
    partitionKey?: string | Expression<string>;
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

export type AzureCosmosDbV1ItemUpdateNode = {
  type: 'n8n-nodes-base.azureCosmosDb';
  version: 1;
  config: NodeConfig<AzureCosmosDbV1ItemUpdateParams> & { credentials?: Credentials };
};
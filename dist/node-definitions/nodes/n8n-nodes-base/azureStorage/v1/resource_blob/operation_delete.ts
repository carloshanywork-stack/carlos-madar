/**
 * Azure Storage Node - Version 1
 * Discriminator: resource=blob, operation=delete
 */


interface Credentials {
  azureStorageOAuth2Api: CredentialReference;
  azureStorageSharedKeyApi: CredentialReference;
}

/** Delete a blob */
export type AzureStorageV1BlobDeleteParams = {
  resource: 'blob';
  operation: 'delete';
  authentication?: 'oAuth2' | 'sharedKey' | Expression<string>;
/**
 * Container to delete a blob from
 * @searchListMethod getContainers
 * @default {"mode":"list","value":""}
 */
    container?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * Blob to be deleted
 * @searchListMethod getBlobs
 * @default {"mode":"list","value":""}
 */
    blob?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * Options
 * @default {}
 */
    options?: {
    /** Required if the blob has an active lease
     */
    leaseId?: string | Expression<string>;
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

export type AzureStorageV1BlobDeleteOutput = {
  connection?: string;
  contentLength?: number;
  date?: string;
  deleteTypePermanent?: boolean;
  requestId?: string;
  server?: string;
  version?: string;
};

export type AzureStorageV1BlobDeleteNode = {
  type: 'n8n-nodes-base.azureStorage';
  version: 1;
  config: NodeConfig<AzureStorageV1BlobDeleteParams> & { credentials?: Credentials };
  output?: Items<AzureStorageV1BlobDeleteOutput>;
};
/**
 * Azure Storage Node - Version 1
 * Discriminator: resource=container, operation=create
 */


interface Credentials {
  azureStorageOAuth2Api: CredentialReference;
  azureStorageSharedKeyApi: CredentialReference;
}

/** Create a new blob or replace an existing one */
export type AzureStorageV1ContainerCreateParams = {
  resource: 'container';
  operation: 'create';
  authentication?: 'oAuth2' | 'sharedKey' | Expression<string>;
/**
 * The name of the new container
 */
    containerCreate: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Access Level
     */
    accessLevel?: 'blob' | 'container' | '' | Expression<string>;
    /** A name-value pair to associate with the container as metadata
     * @default []
     */
    metadata?: {
        /** Metadata
     */
    metadataValues?: Array<{
      /** Names must adhere to the naming rules for &lt;a href="https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/"&gt;C# identifiers&lt;/a&gt;
       */
      fieldName?: string | Expression<string>;
      /** Field Value
       */
      fieldValue?: string | Expression<string>;
    }>;
  };
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

export type AzureStorageV1ContainerCreateNode = {
  type: 'n8n-nodes-base.azureStorage';
  version: 1;
  config: NodeConfig<AzureStorageV1ContainerCreateParams> & { credentials?: Credentials };
};
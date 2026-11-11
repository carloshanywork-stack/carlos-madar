/**
 * Azure Cosmos DB Node - Version 1
 * Discriminator: resource=item, operation=getAll
 */


interface Credentials {
  microsoftAzureCosmosDbSharedKeyApi: CredentialReference;
}

/** Retrieve a list of containers */
export type AzureCosmosDbV1ItemGetAllParams = {
  resource: 'item';
  operation: 'getAll';
/**
 * Select the container you want to use
 * @searchListMethod searchContainers
 * @default {"mode":"list","value":""}
 */
    container?: { __rl: true; mode: 'list' | 'id'; value: string; cachedResultName?: string };
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 50
 */
    limit?: number | Expression<number>;
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

export type AzureCosmosDbV1ItemGetAllOutput = {
  createdDate?: string;
  documentType?: string;
  estadoManifiesto?: string;
  estadoValidacion?: string;
  eTag?: string;
  fechaExpedicionManifiesto?: string;
  id?: string;
  ingresoIdManifiesto?: number;
  isActive?: boolean;
  lastModifiedDate?: string;
  lastUpdateDate?: string;
  metadata?: null;
  numNitEmpresaTransporte?: string;
  numPlaca?: string;
  partitionKey?: string;
  procesado?: boolean;
  puntosControl?: Array<{
    codPuntoControl?: number;
    estadoPunto?: string;
    fechaCita?: string;
  }>;
  resourceId?: string;
  selfLink?: string;
  timeStamp?: number;
};

export type AzureCosmosDbV1ItemGetAllNode = {
  type: 'n8n-nodes-base.azureCosmosDb';
  version: 1;
  config: NodeConfig<AzureCosmosDbV1ItemGetAllParams> & { credentials?: Credentials };
  output?: Items<AzureCosmosDbV1ItemGetAllOutput>;
};
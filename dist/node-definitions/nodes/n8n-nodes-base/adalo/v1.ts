/**
 * Adalo Node - Version 1
 * Consume Adalo API
 */


export interface AdaloV1Params {
  resource?: 'collection';
  operation?: 'create' | 'delete' | 'get' | 'getAll' | 'update';
/**
 * Open your Adalo application and click on the three buttons beside the collection name, then select API Documentation
 * @hint You can find information about app's collections on https://app.adalo.com/apps/&lt;strong&gt;your-app-id&lt;/strong&gt;/api-docs
 * @displayOptions.show { resource: ["collection"] }
 * @required when the displayOptions conditions above match
 */
    collectionId?: string | Expression<string>;
/**
 * Row ID
 * @displayOptions.show { operation: ["get", "delete", "update"], resource: ["collection"] }
 * @required when the displayOptions conditions above match
 */
    rowId?: string | Expression<string>;
/**
 * Whether to insert the input data this node receives in the new row
 * @displayOptions.show { operation: ["create", "update"], resource: ["collection"] }
 * @default defineBelow
 */
    dataToSend?: 'autoMapInputData' | 'defineBelow' | Expression<string>;
/**
 * List of input properties to avoid sending, separated by commas. Leave empty to send all properties.
 * @displayOptions.show { operation: ["create", "update"], dataToSend: ["autoMapInputData"], resource: ["collection"] }
 */
    inputsToIgnore?: string | Expression<string>;
/**
 * Field must be defined in the collection, otherwise it will be ignored. If field defined in the collection is not set here, it will be set to null.
 * @displayOptions.show { operation: ["create", "update"], dataToSend: ["defineBelow"], resource: ["collection"] }
 * @default {}
 */
    fieldsUi?: {
        /** Field
     */
    fieldValues?: Array<{
      /** Field ID
       */
      fieldId?: string | Expression<string>;
      /** Field Value
       */
      fieldValue?: string | Expression<string>;
    }>;
  };
/**
 * Whether to return all results or only up to a given limit
 * @displayOptions.show { operation: ["getAll"], resource: ["collection"] }
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { operation: ["getAll"], resource: ["collection"], returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
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
}

export interface AdaloV1Credentials {
  adaloApi: CredentialReference;
}

interface AdaloV1NodeBase {
  type: 'n8n-nodes-base.adalo';
  version: 1;
}

export type AdaloV1ParamsNode = AdaloV1NodeBase & {
  config: NodeConfig<AdaloV1Params> & { credentials?: AdaloV1Credentials };
};

export type AdaloV1Node = AdaloV1ParamsNode;
/**
 * BambooHR Node - Version 1
 * Discriminator: resource=file, operation=getAll
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Get many employees */
export type BambooHrV1FileGetAllParams = {
  resource: 'file';
  operation: 'getAll';
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 5
 */
    limit?: number | Expression<number>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simplifyOutput?: boolean | Expression<boolean>;
};

export type BambooHrV1FileGetAllNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1FileGetAllParams> & { credentials?: Credentials };
};
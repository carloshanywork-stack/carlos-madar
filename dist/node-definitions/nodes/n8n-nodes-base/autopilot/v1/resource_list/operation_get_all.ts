/**
 * Autopilot Node - Version 1
 * Discriminator: resource=list, operation=getAll
 */


interface Credentials {
  autopilotApi: CredentialReference;
}

/** Get many contacts */
export type AutopilotV1ListGetAllParams = {
  resource: 'list';
  operation: 'getAll';
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
};

export type AutopilotV1ListGetAllNode = {
  type: 'n8n-nodes-base.autopilot';
  version: 1;
  config: NodeConfig<AutopilotV1ListGetAllParams> & { credentials?: Credentials };
};
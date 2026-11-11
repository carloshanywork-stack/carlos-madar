/**
 * Autopilot Node - Version 1
 * Discriminator: resource=contact, operation=getAll
 */


interface Credentials {
  autopilotApi: CredentialReference;
}

/** Get many contacts */
export type AutopilotV1ContactGetAllParams = {
  resource: 'contact';
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

export type AutopilotV1ContactGetAllNode = {
  type: 'n8n-nodes-base.autopilot';
  version: 1;
  config: NodeConfig<AutopilotV1ContactGetAllParams> & { credentials?: Credentials };
};
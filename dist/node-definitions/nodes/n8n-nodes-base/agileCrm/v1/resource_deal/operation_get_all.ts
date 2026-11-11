/**
 * Agile CRM Node - Version 1
 * Discriminator: resource=deal, operation=getAll
 */


interface Credentials {
  agileCrmApi: CredentialReference;
}

/** Get many contacts */
export type AgileCrmV1DealGetAllParams = {
  resource: 'deal';
  operation: 'getAll';
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 20
 */
    limit?: number | Expression<number>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
};

export type AgileCrmV1DealGetAllNode = {
  type: 'n8n-nodes-base.agileCrm';
  version: 1;
  config: NodeConfig<AgileCrmV1DealGetAllParams> & { credentials?: Credentials };
};
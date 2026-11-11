/**
 * Action Network Node - Version 1
 * Discriminator: resource=event, operation=getAll
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1EventGetAllParams = {
  resource: 'event';
  operation: 'getAll';
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
};

export type ActionNetworkV1EventGetAllNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1EventGetAllParams> & { credentials?: Credentials };
};
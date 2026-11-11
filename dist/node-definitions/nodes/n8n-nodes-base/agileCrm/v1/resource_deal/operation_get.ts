/**
 * Agile CRM Node - Version 1
 * Discriminator: resource=deal, operation=get
 */


interface Credentials {
  agileCrmApi: CredentialReference;
}

/** Get a contact */
export type AgileCrmV1DealGetParams = {
  resource: 'deal';
  operation: 'get';
/**
 * Unique identifier for a particular deal
 */
    dealId: string | Expression<string>;
};

export type AgileCrmV1DealGetNode = {
  type: 'n8n-nodes-base.agileCrm';
  version: 1;
  config: NodeConfig<AgileCrmV1DealGetParams> & { credentials?: Credentials };
};
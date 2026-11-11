/**
 * Agile CRM Node - Version 1
 * Discriminator: resource=deal, operation=delete
 */


interface Credentials {
  agileCrmApi: CredentialReference;
}

/** Delete a contact */
export type AgileCrmV1DealDeleteParams = {
  resource: 'deal';
  operation: 'delete';
/**
 * ID of deal to delete
 */
    dealId: string | Expression<string>;
};

export type AgileCrmV1DealDeleteNode = {
  type: 'n8n-nodes-base.agileCrm';
  version: 1;
  config: NodeConfig<AgileCrmV1DealDeleteParams> & { credentials?: Credentials };
};
/**
 * Agile CRM Node - Version 1
 * Discriminator: resource=company, operation=delete
 */


interface Credentials {
  agileCrmApi: CredentialReference;
}

/** Delete a contact */
export type AgileCrmV1CompanyDeleteParams = {
  resource: 'company';
  operation: 'delete';
/**
 * ID of company to delete
 */
    companyId: string | Expression<string>;
};

export type AgileCrmV1CompanyDeleteNode = {
  type: 'n8n-nodes-base.agileCrm';
  version: 1;
  config: NodeConfig<AgileCrmV1CompanyDeleteParams> & { credentials?: Credentials };
};
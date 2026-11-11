/**
 * Agile CRM Node - Version 1
 * Discriminator: resource=contact, operation=delete
 */


interface Credentials {
  agileCrmApi: CredentialReference;
}

/** Delete a contact */
export type AgileCrmV1ContactDeleteParams = {
  resource: 'contact';
  operation: 'delete';
/**
 * ID of contact to delete
 */
    contactId: string | Expression<string>;
};

export type AgileCrmV1ContactDeleteNode = {
  type: 'n8n-nodes-base.agileCrm';
  version: 1;
  config: NodeConfig<AgileCrmV1ContactDeleteParams> & { credentials?: Credentials };
};
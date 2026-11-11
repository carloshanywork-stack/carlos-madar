/**
 * Agile CRM Node - Version 1
 * Discriminator: resource=contact, operation=get
 */


interface Credentials {
  agileCrmApi: CredentialReference;
}

/** Get a contact */
export type AgileCrmV1ContactGetParams = {
  resource: 'contact';
  operation: 'get';
/**
 * Unique identifier for a particular contact
 */
    contactId: string | Expression<string>;
};

export type AgileCrmV1ContactGetNode = {
  type: 'n8n-nodes-base.agileCrm';
  version: 1;
  config: NodeConfig<AgileCrmV1ContactGetParams> & { credentials?: Credentials };
};
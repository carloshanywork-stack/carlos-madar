/**
 * Autopilot Node - Version 1
 * Discriminator: resource=contact, operation=get
 */


interface Credentials {
  autopilotApi: CredentialReference;
}

/** Get a contact */
export type AutopilotV1ContactGetParams = {
  resource: 'contact';
  operation: 'get';
/**
 * Can be ID or email
 */
    contactId: string | Expression<string>;
};

export type AutopilotV1ContactGetNode = {
  type: 'n8n-nodes-base.autopilot';
  version: 1;
  config: NodeConfig<AutopilotV1ContactGetParams> & { credentials?: Credentials };
};
/**
 * Autopilot Node - Version 1
 * Discriminator: resource=contact, operation=delete
 */


interface Credentials {
  autopilotApi: CredentialReference;
}

/** Delete a contact */
export type AutopilotV1ContactDeleteParams = {
  resource: 'contact';
  operation: 'delete';
/**
 * Can be ID or email
 */
    contactId: string | Expression<string>;
};

export type AutopilotV1ContactDeleteNode = {
  type: 'n8n-nodes-base.autopilot';
  version: 1;
  config: NodeConfig<AutopilotV1ContactDeleteParams> & { credentials?: Credentials };
};
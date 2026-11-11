/**
 * Autopilot Node - Version 1
 * Discriminator: resource=contactList, operation=remove
 */


interface Credentials {
  autopilotApi: CredentialReference;
}

/** Remove a contact from a list */
export type AutopilotV1ContactListRemoveParams = {
  resource: 'contactList';
  operation: 'remove';
/**
 * ID of the list to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getLists
 */
    listId: string | Expression<string>;
/**
 * Can be ID or email
 */
    contactId: string | Expression<string>;
};

export type AutopilotV1ContactListRemoveNode = {
  type: 'n8n-nodes-base.autopilot';
  version: 1;
  config: NodeConfig<AutopilotV1ContactListRemoveParams> & { credentials?: Credentials };
};
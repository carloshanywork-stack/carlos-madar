/**
 * Autopilot Node - Version 1
 * Discriminator: resource=contactList, operation=add
 */


interface Credentials {
  autopilotApi: CredentialReference;
}

/** Add contact to list */
export type AutopilotV1ContactListAddParams = {
  resource: 'contactList';
  operation: 'add';
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

export type AutopilotV1ContactListAddNode = {
  type: 'n8n-nodes-base.autopilot';
  version: 1;
  config: NodeConfig<AutopilotV1ContactListAddParams> & { credentials?: Credentials };
};
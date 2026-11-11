/**
 * Autopilot Node - Version 1
 * Discriminator: resource=contactList, operation=getAll
 */


interface Credentials {
  autopilotApi: CredentialReference;
}

/** Get many contacts */
export type AutopilotV1ContactListGetAllParams = {
  resource: 'contactList';
  operation: 'getAll';
/**
 * ID of the list to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getLists
 */
    listId: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
};

export type AutopilotV1ContactListGetAllNode = {
  type: 'n8n-nodes-base.autopilot';
  version: 1;
  config: NodeConfig<AutopilotV1ContactListGetAllParams> & { credentials?: Credentials };
};
/**
 * Webex by Cisco Node - Version 1
 * Discriminator: resource=message, operation=getAll
 */


interface Credentials {
  ciscoWebexOAuth2Api: CredentialReference;
}

export type CiscoWebexV1MessageGetAllParams = {
  resource: 'message';
  operation: 'getAll';
/**
 * List messages in a room, by ID. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getRooms
 */
    roomId: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 50
 */
    limit?: number | Expression<number>;
/**
 * Filters
 * @default {}
 */
    filters?: {
    /** List messages sent before a date and time
     */
    before?: string | Expression<string>;
    /** List messages sent before a message, by ID
     */
    beforeMessage?: string | Expression<string>;
    /** List messages with a parent, by ID
     */
    parentId?: string | Expression<string>;
    /** List only messages with certain person mentioned. Enter their ID. You can use 'me' as a shorthand for yourself
     */
    mentionedPeople?: string | Expression<string>;
  };
};

export type CiscoWebexV1MessageGetAllNode = {
  type: 'n8n-nodes-base.ciscoWebex';
  version: 1;
  config: NodeConfig<CiscoWebexV1MessageGetAllParams> & { credentials?: Credentials };
};
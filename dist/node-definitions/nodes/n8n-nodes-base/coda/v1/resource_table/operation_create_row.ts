/**
 * Coda Node - Version 1
 * Discriminator: resource=table, operation=createRow
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of tables in documents */
export type CodaV1TableCreateRowParams = {
  resource: 'table';
  operation: 'createRow';
/**
 * ID of the doc. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDocs
 */
    docId: string | Expression<string>;
/**
 * The table to create the row in. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTables
 */
    tableId: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Whether the API will not attempt to parse the data in any way
     * @default false
     */
    disableParsing?: boolean | Expression<boolean>;
    /** Optional column IDs, URLs, or names (fragile and discouraged), specifying columns to be used as upsert keys. If more than one separate by a comma (,).
     */
    keyColumns?: string | Expression<string>;
  };
};

export type CodaV1TableCreateRowOutput = {
  InboundMessage?: string;
  LeadEmail?: string;
  LeadID?: string;
  LeadLinkedInURL?: string;
  LeadName?: string;
  MsgStatus?: string;
};

export type CodaV1TableCreateRowNode = {
  type: 'n8n-nodes-base.coda';
  version: 1;
  config: NodeConfig<CodaV1TableCreateRowParams> & { credentials?: Credentials };
  output?: Items<CodaV1TableCreateRowOutput>;
};
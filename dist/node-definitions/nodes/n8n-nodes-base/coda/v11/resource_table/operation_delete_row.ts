/**
 * Coda Node - Version 1.1
 * Discriminator: resource=table, operation=deleteRow
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of tables in documents */
export type CodaV11TableDeleteRowParams = {
  resource: 'table';
  operation: 'deleteRow';
/**
 * ID of the doc. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDocs
 */
    docId: string | Expression<string>;
/**
 * The table to delete the row in. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTables
 */
    tableId: string | Expression<string>;
/**
 * Row IDs to delete
 */
    rowId: string | Expression<string>;
};

export type CodaV11TableDeleteRowNode = {
  type: 'n8n-nodes-base.coda';
  version: 1.1;
  config: NodeConfig<CodaV11TableDeleteRowParams> & { credentials?: Credentials };
};
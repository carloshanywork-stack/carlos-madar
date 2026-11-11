/**
 * Coda Node - Version 1.1
 * Discriminator: resource=table, operation=getColumn
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of tables in documents */
export type CodaV11TableGetColumnParams = {
  resource: 'table';
  operation: 'getColumn';
/**
 * ID of the doc. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDocs
 */
    docId: string | Expression<string>;
/**
 * The table to get the row from. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTables
 */
    tableId: string | Expression<string>;
/**
 * The table to get the row from
 */
    columnId: string | Expression<string>;
};

export type CodaV11TableGetColumnNode = {
  type: 'n8n-nodes-base.coda';
  version: 1.1;
  config: NodeConfig<CodaV11TableGetColumnParams> & { credentials?: Credentials };
};
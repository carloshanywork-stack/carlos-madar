/**
 * Coda Node - Version 1
 * Discriminator: resource=table, operation=pushButton
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of tables in documents */
export type CodaV1TablePushButtonParams = {
  resource: 'table';
  operation: 'pushButton';
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
 * ID or name of the row. Names are discouraged because they're easily prone to being changed by users. If you're using a name, be sure to URI-encode it. If there are multiple rows with the same value in the identifying column, an arbitrary one will be selected
 */
    rowId: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getColumns
 */
    columnId: string | Expression<string>;
};

export type CodaV1TablePushButtonOutput = {
  columnId?: string;
  requestId?: string;
  rowId?: string;
};

export type CodaV1TablePushButtonNode = {
  type: 'n8n-nodes-base.coda';
  version: 1;
  config: NodeConfig<CodaV1TablePushButtonParams> & { credentials?: Credentials };
  output?: Items<CodaV1TablePushButtonOutput>;
};
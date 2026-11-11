/**
 * Coda Node - Version 1
 * Discriminator: resource=table, operation=getRow
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of tables in documents */
export type CodaV1TableGetRowParams = {
  resource: 'table';
  operation: 'getRow';
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
 * Options
 * @default {}
 */
    options?: {
    /** Whether to return the data exactly in the way it got received from the API
     * @default false
     */
    rawData?: boolean | Expression<boolean>;
    /** Whether to use column names instead of column IDs in the returned output. This is generally discouraged as it is fragile. If columns are renamed, code using original names may throw errors.
     * @default false
     */
    useColumnNames?: boolean | Expression<boolean>;
    /** The format that cell values are returned as
     */
    valueFormat?: 'simple' | 'simpleWithArrays' | 'rich' | Expression<string>;
  };
};

export type CodaV1TableGetRowOutput = {
  id?: string;
};

export type CodaV1TableGetRowNode = {
  type: 'n8n-nodes-base.coda';
  version: 1;
  config: NodeConfig<CodaV1TableGetRowParams> & { credentials?: Credentials };
  output?: Items<CodaV1TableGetRowOutput>;
};
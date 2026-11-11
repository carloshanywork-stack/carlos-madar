/**
 * Coda Node - Version 1.1
 * Discriminator: resource=table, operation=getAllRows
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of tables in documents */
export type CodaV11TableGetAllRowsParams = {
  resource: 'table';
  operation: 'getAllRows';
/**
 * ID of the doc. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDocs
 */
    docId: string | Expression<string>;
/**
 * The table to get the rows from. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTables
 */
    tableId: string | Expression<string>;
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
 * Options
 * @default {}
 */
    options?: {
    /** Query used to filter returned rows, specified as &lt;column_id_or_name&gt;:&lt;value&gt;. If you'd like to use a column name instead of an ID, you must quote it (e.g., "My Column":123). Also note that value is a JSON value; if you'd like to use a string, you must surround it in quotes (e.g., "groceries").
     */
    query?: string | Expression<string>;
    /** Whether to return the data exactly in the way it got received from the API
     * @default false
     */
    rawData?: boolean | Expression<boolean>;
    /** Specifies the sort order of the rows returned. If left unspecified, rows are returned by creation time ascending.
     */
    sortBy?: 'createdAt' | 'natural' | Expression<string>;
    /** Whether to use column names instead of column IDs in the returned output. This is generally discouraged as it is fragile. If columns are renamed, code using original names may throw errors.
     * @default false
     */
    useColumnNames?: boolean | Expression<boolean>;
    /** The format that cell values are returned as
     */
    valueFormat?: 'simple' | 'simpleWithArrays' | 'rich' | Expression<string>;
    /** Whether to return only visible rows and columns for the table
     * @default false
     */
    visibleOnly?: boolean | Expression<boolean>;
  };
};

export type CodaV11TableGetAllRowsOutput = {
  id?: string;
  pathway?: string;
  promise?: string;
  scope?: string;
};

export type CodaV11TableGetAllRowsNode = {
  type: 'n8n-nodes-base.coda';
  version: 1.1;
  config: NodeConfig<CodaV11TableGetAllRowsParams> & { credentials?: Credentials };
  output?: Items<CodaV11TableGetAllRowsOutput>;
};
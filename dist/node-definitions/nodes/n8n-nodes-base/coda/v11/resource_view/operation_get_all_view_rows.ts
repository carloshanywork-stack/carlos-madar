/**
 * Coda Node - Version 1.1
 * Discriminator: resource=view, operation=getAllViewRows
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of views in documents */
export type CodaV11ViewGetAllViewRowsParams = {
  resource: 'view';
  operation: 'getAllViewRows';
/**
 * ID of the doc. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDocs
 */
    docId: string | Expression<string>;
/**
 * The table to get the rows from. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getViews
 */
    viewId: string | Expression<string>;
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
    /** Whether to use column names instead of column IDs in the returned output. This is generally discouraged as it is fragile. If columns are renamed, code using original names may throw errors.
     * @default false
     */
    useColumnNames?: boolean | Expression<boolean>;
    /** The format that cell values are returned as
     */
    valueFormat?: 'simple' | 'simpleWithArrays' | 'rich' | Expression<string>;
    /** Whether to return the data exactly in the way it got received from the API
     * @default false
     */
    rawData?: boolean | Expression<boolean>;
    /** Specifies the sort order of the rows returned. If left unspecified, rows are returned by creation time ascending.
     */
    sortBy?: 'createdAt' | 'natural' | Expression<string>;
  };
};

export type CodaV11ViewGetAllViewRowsOutput = {
  'Contract ID'?: string;
  'Contract Link'?: string;
  'Contract Notes'?: string;
  'Contract Signature Date'?: string;
  contractTextOutput?: string;
  'Created on'?: string;
  'Do not use name/logo?'?: boolean;
  extractText?: string;
  fileSize?: string;
  'Full Deletion Required?'?: boolean;
  id?: string;
  'IT Addendum?'?: boolean;
  lastUpdated?: string;
  'over4MB?'?: boolean;
  'Processing Organization'?: string;
  rowID?: number;
  'Status Date'?: string;
  Summarize?: string;
  Summary?: string;
};

export type CodaV11ViewGetAllViewRowsNode = {
  type: 'n8n-nodes-base.coda';
  version: 1.1;
  config: NodeConfig<CodaV11ViewGetAllViewRowsParams> & { credentials?: Credentials };
  output?: Items<CodaV11ViewGetAllViewRowsOutput>;
};
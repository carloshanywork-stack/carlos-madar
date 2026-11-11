/**
 * Coda Node - Version 1
 * Discriminator: resource=table, operation=getAllColumns
 */


interface Credentials {
  codaApi: CredentialReference;
}

/** Access data of tables in documents */
export type CodaV1TableGetAllColumnsParams = {
  resource: 'table';
  operation: 'getAllColumns';
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
};

export type CodaV1TableGetAllColumnsOutput = {
  display?: boolean;
  format?: {
    isArray?: boolean;
    type?: string;
  };
  href?: string;
  id?: string;
  name?: string;
  type?: string;
};

export type CodaV1TableGetAllColumnsNode = {
  type: 'n8n-nodes-base.coda';
  version: 1;
  config: NodeConfig<CodaV1TableGetAllColumnsParams> & { credentials?: Credentials };
  output?: Items<CodaV1TableGetAllColumnsOutput>;
};
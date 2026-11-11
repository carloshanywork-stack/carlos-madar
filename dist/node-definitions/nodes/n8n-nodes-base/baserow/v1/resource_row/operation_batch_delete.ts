/**
 * Baserow Node - Version 1
 * Discriminator: resource=row, operation=batchDelete
 */


interface Credentials {
  baserowApi: CredentialReference;
  baserowTokenApi: CredentialReference;
}

/** Delete up to 200 rows in one request */
export type BaserowV1RowBatchDeleteParams = {
  resource: 'row';
  operation: 'batchDelete';
  authentication?: 'usernamePassword' | 'databaseToken' | Expression<string>;
/**
 * Database to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDatabaseIds
 * @displayOptions.hide { authentication: ["databaseToken"] }
 * @default 0
 */
    databaseId?: string | Expression<string>;
/**
 * Table to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTableIds
 */
    tableId: string | Expression<string>;
/**
 * Choose whether to manually enter row IDs or map them from input data
 * @default defineBelow
 */
    dataToSend?: 'autoMapInputData' | 'defineBelow' | Expression<string>;
/**
 * IDs of the rows to delete
 * @displayOptions.show { dataToSend: ["defineBelow"] }
 * @default []
 */
    rowIds?: Array<string | Expression<string>>;
/**
 * Name of the property in each input item that contains the row ID
 * @displayOptions.show { dataToSend: ["autoMapInputData"] }
 * @default id
 */
    rowIdProperty?: string | Expression<string>;
};

export type BaserowV1RowBatchDeleteNode = {
  type: 'n8n-nodes-base.baserow';
  version: 1;
  config: NodeConfig<BaserowV1RowBatchDeleteParams> & { credentials?: Credentials };
};
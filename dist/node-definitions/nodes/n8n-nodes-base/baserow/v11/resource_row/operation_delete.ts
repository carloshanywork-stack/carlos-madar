/**
 * Baserow Node - Version 1.1
 * Discriminator: resource=row, operation=delete
 */


interface Credentials {
  baserowApi: CredentialReference;
  baserowTokenApi: CredentialReference;
}

/** Delete a row */
export type BaserowV11RowDeleteParams = {
  resource: 'row';
  operation: 'delete';
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
 * ID of the row to delete
 */
    rowId: string | Expression<string>;
};

export type BaserowV11RowDeleteNode = {
  type: 'n8n-nodes-base.baserow';
  version: 1.1;
  config: NodeConfig<BaserowV11RowDeleteParams> & { credentials?: Credentials };
};
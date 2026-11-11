/**
 * Baserow Node - Version 1
 * Discriminator: resource=row, operation=batchUpdate
 */


interface Credentials {
  baserowApi: CredentialReference;
  baserowTokenApi: CredentialReference;
}

/** Update up to 200 rows in one request */
export type BaserowV1RowBatchUpdateParams = {
  resource: 'row';
  operation: 'batchUpdate';
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
 * Whether to insert the input data this node receives in the new row
 * @default defineBelow
 */
    dataToSend?: 'autoMapInputData' | 'defineBelow' | Expression<string>;
/**
 * List of input properties to avoid sending, separated by commas. Leave empty to send all properties.
 * @displayOptions.show { dataToSend: ["autoMapInputData"] }
 */
    inputsToIgnore?: string | Expression<string>;
/**
 * Rows
 * @displayOptions.show { dataToSend: ["defineBelow"] }
 * @default []
 */
    rowsUi?: {
        /** Row
     */
    rowValues?: Array<{
      /** Row ID to update (required for batch update)
       */
      id?: string | Expression<string>;
      /** Fields
       * @default {}
       */
      fieldsUi?: {
        /** Field
     */
    fieldValues?: Array<{
      /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
       * @loadOptionsMethod getTableFields
       */
      fieldId?: string | Expression<string>;
      /** Field Value
       */
      fieldValue?: string | Expression<string>;
    }>;
  };
    }>;
  };
};

export type BaserowV1RowBatchUpdateNode = {
  type: 'n8n-nodes-base.baserow';
  version: 1;
  config: NodeConfig<BaserowV1RowBatchUpdateParams> & { credentials?: Credentials };
};
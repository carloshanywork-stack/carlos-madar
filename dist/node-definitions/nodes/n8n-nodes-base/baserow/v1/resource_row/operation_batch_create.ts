/**
 * Baserow Node - Version 1
 * Discriminator: resource=row, operation=batchCreate
 */


interface Credentials {
  baserowApi: CredentialReference;
  baserowTokenApi: CredentialReference;
}

/** Create up to 200 rows in one request */
export type BaserowV1RowBatchCreateParams = {
  resource: 'row';
  operation: 'batchCreate';
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

export type BaserowV1RowBatchCreateNode = {
  type: 'n8n-nodes-base.baserow';
  version: 1;
  config: NodeConfig<BaserowV1RowBatchCreateParams> & { credentials?: Credentials };
};
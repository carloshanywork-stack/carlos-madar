/**
 * Baserow Node - Version 1
 * Discriminator: resource=row, operation=update
 */


interface Credentials {
  baserowApi: CredentialReference;
  baserowTokenApi: CredentialReference;
}

/** Update a row */
export type BaserowV1RowUpdateParams = {
  resource: 'row';
  operation: 'update';
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
 * ID of the row to update
 */
    rowId: string | Expression<string>;
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
 * Fields to Send
 * @displayOptions.show { dataToSend: ["defineBelow"] }
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
};

export type BaserowV1RowUpdateNode = {
  type: 'n8n-nodes-base.baserow';
  version: 1;
  config: NodeConfig<BaserowV1RowUpdateParams> & { credentials?: Credentials };
};
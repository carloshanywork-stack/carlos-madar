/**
 * Baserow Node - Version 1.1
 * Discriminator: resource=row, operation=create
 */


interface Credentials {
  baserowApi: CredentialReference;
  baserowTokenApi: CredentialReference;
}

/** Create a row */
export type BaserowV11RowCreateParams = {
  resource: 'row';
  operation: 'create';
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

export type BaserowV11RowCreateNode = {
  type: 'n8n-nodes-base.baserow';
  version: 1.1;
  config: NodeConfig<BaserowV11RowCreateParams> & { credentials?: Credentials };
};
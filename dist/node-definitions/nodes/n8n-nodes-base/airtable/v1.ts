/**
 * Airtable Node - Version 1
 * Read, update, write and delete data from Airtable
 */


export interface AirtableV1Params {
  authentication?: 'airtableTokenApi' | 'airtableOAuth2Api' | 'airtableApi' | Expression<string>;
  operation?: 'append' | 'delete' | 'list' | 'read' | 'update';
/**
 * The Airtable Base in which to operate on
 * @default {"mode":"url","value":""}
 */
    application?: { __rl: true; mode: 'url' | 'id'; value: string; cachedResultName?: string };
  table?: { __rl: true; mode: 'url' | 'id'; value: string; cachedResultName?: string };
/**
 * Whether all fields should be sent to Airtable or only specific ones
 * @displayOptions.show { operation: ["append"] }
 * @default true
 */
    addAllFields?: boolean | Expression<boolean>;
/**
 * The name of fields for which data should be sent to Airtable
 * @displayOptions.show { addAllFields: [false], operation: ["append"] }
 * @default []
 */
    fields?: Array<string | Expression<string>>;
/**
 * ID of the record to delete
 * @displayOptions.show { operation: ["delete"] }
 * @required when the displayOptions conditions above match
 */
    id?: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @displayOptions.show { operation: ["list"] }
 * @default true
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { operation: ["list"], returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Whether the attachment fields define in 'Download Fields' will be downloaded
 * @displayOptions.show { operation: ["list"] }
 * @default false
 */
    downloadAttachments?: boolean | Expression<boolean>;
/**
 * Name of the fields of type 'attachment' that should be downloaded. Multiple ones can be defined separated by comma. Case sensitive and cannot include spaces after a comma.
 * @displayOptions.show { operation: ["list"], downloadAttachments: [true] }
 * @required when the displayOptions conditions above match
 */
    downloadFieldNames?: string | Expression<string>;
/**
 * Additional options which decide which records should be returned
 * @displayOptions.show { operation: ["list"] }
 * @default {}
 */
    additionalOptions?: {
    /** Only data for fields whose names are in this list will be included in the records
     * @default []
     */
    fields?: Array<string | Expression<string>>;
    /** A formula used to filter records. The formula will be evaluated for each record, and if the result is not 0, false, "", NaN, [], or #Error! the record will be included in the response.
     */
    filterByFormula?: string | Expression<string>;
    /** Defines how the returned records should be ordered
     * @default {}
     */
    sort?: {
        /** Property
     */
    property?: Array<{
      /** Name of the field to sort on
       */
      field?: string | Expression<string>;
      /** The sort direction
       * @default asc
       */
      direction?: 'asc' | 'desc' | Expression<string>;
    }>;
  };
    /** The name or ID of a view in the Stories table. If set, only the records in that view will be returned. The records will be sorted according to the order of the view.
     */
    view?: string | Expression<string>;
  };
/**
 * Whether all fields should be sent to Airtable or only specific ones
 * @displayOptions.show { operation: ["update"] }
 * @default true
 */
    updateAllFields?: boolean | Expression<boolean>;
/**
 * Options
 * @displayOptions.show { operation: ["append", "delete", "update"] }
 * @default {}
 */
    options?: {
    /** Number of records to process at once
     * @default 10
     */
    bulkSize?: number | Expression<number>;
    /** Comma-separated list of fields to ignore
     * @displayOptions.show { /operation: ["update"], /updateAllFields: [true] }
     */
    ignoreFields?: string | Expression<string>;
    /** Whether the Airtable API should attempt mapping of string values for linked records & select options
     * @displayOptions.show { /operation: ["append", "update"] }
     * @default false
     */
    typecast?: boolean | Expression<boolean>;
  };
}

export interface AirtableV1Credentials {
  airtableApi: CredentialReference;
  airtableTokenApi: CredentialReference;
  airtableOAuth2Api: CredentialReference;
}

interface AirtableV1NodeBase {
  type: 'n8n-nodes-base.airtable';
  version: 1;
}

export type AirtableV1ParamsNode = AirtableV1NodeBase & {
  config: NodeConfig<AirtableV1Params> & { credentials?: AirtableV1Credentials };
};

export type AirtableV1Node = AirtableV1ParamsNode;
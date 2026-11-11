/**
 * Airtable Node - Version 2
 * Discriminator: resource=record, operation=search
 */


interface Credentials {
  airtableTokenApi: CredentialReference;
  airtableOAuth2Api: CredentialReference;
}

/** Search for specific records or list all */
export type AirtableV2RecordSearchParams = {
  resource: 'record';
  operation: 'search';
  authentication?: 'airtableTokenApi' | 'airtableOAuth2Api' | Expression<string>;
/**
 * Base
 * @searchListMethod baseSearch
 * @default {"mode":"list","value":""}
 */
    base?: { __rl: true; mode: 'list' | 'url' | 'id'; value: string; cachedResultName?: string };
/**
 * Table
 * @searchListMethod tableSearch
 * @default {"mode":"list","value":""}
 */
    table?: { __rl: true; mode: 'list' | 'url' | 'id'; value: string; cachedResultName?: string };
/**
 * The formula will be evaluated for each record, and if the result is not 0, false, "", NaN, [], or #Error! the record will be included in the response. &lt;a href="https://support.airtable.com/docs/formula-field-reference" target="_blank"&gt;More info&lt;/a&gt;.
 * @hint If empty, all the records will be returned
 */
    filterByFormula?: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default true
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Additional options which decide which records should be returned
 * @default {}
 */
    options?: {
    /** The fields of type 'attachment' that should be downloaded
     * @loadOptionsMethod getAttachmentColumns
     * @default []
     */
    downloadFields?: string[];
    /** The fields you want to include in the output
     * @loadOptionsMethod getColumns
     * @default []
     */
    fields?: string[];
    /** View
     * @searchListMethod viewSearch
     * @default {"mode":"list","value":""}
     */
    view?: { __rl: true; mode: 'list' | 'url' | 'id'; value: string; cachedResultName?: string };
  };
/**
 * Defines how the returned records should be ordered
 * @default {}
 */
    sort?: {
        /** Property
     */
    property?: Array<{
      /** Name of the field to sort on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
       * @loadOptionsMethod getColumns
       */
      field?: string | Expression<string>;
      /** The sort direction
       * @default asc
       */
      direction?: 'asc' | 'desc' | Expression<string>;
    }>;
  };
};

export type AirtableV2RecordSearchNode = {
  type: 'n8n-nodes-base.airtable';
  version: 2;
  config: NodeConfig<AirtableV2RecordSearchParams> & { credentials?: Credentials };
};
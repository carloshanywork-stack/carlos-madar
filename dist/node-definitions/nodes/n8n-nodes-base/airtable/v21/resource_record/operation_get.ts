/**
 * Airtable Node - Version 2.1
 * Discriminator: resource=record, operation=get
 */


interface Credentials {
  airtableTokenApi: CredentialReference;
  airtableOAuth2Api: CredentialReference;
}

/** Retrieve a record from a table */
export type AirtableV21RecordGetParams = {
  resource: 'record';
  operation: 'get';
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
 * ID of the record to get. &lt;a href="https://support.airtable.com/docs/record-id" target="_blank"&gt;More info&lt;/a&gt;.
 */
    id: string | Expression<string>;
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
  };
};

export type AirtableV21RecordGetNode = {
  type: 'n8n-nodes-base.airtable';
  version: 2.1;
  config: NodeConfig<AirtableV21RecordGetParams> & { credentials?: Credentials };
};
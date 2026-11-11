/**
 * Airtable Node - Version 2
 * Discriminator: resource=record, operation=deleteRecord
 */


interface Credentials {
  airtableTokenApi: CredentialReference;
  airtableOAuth2Api: CredentialReference;
}

/** Delete a record from a table */
export type AirtableV2RecordDeleteRecordParams = {
  resource: 'record';
  operation: 'deleteRecord';
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
 * ID of the record to delete. &lt;a href="https://support.airtable.com/docs/record-id" target="_blank"&gt;More info&lt;/a&gt;.
 */
    id: string | Expression<string>;
};

export type AirtableV2RecordDeleteRecordNode = {
  type: 'n8n-nodes-base.airtable';
  version: 2;
  config: NodeConfig<AirtableV2RecordDeleteRecordParams> & { credentials?: Credentials };
};
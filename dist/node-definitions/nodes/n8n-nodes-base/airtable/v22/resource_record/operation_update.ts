/**
 * Airtable Node - Version 2.2
 * Discriminator: resource=record, operation=update
 */


// Helper types for special n8n fields
type ResourceMapperField = { id?: string; displayName?: string; required?: boolean; defaultMatch?: boolean; display?: boolean; type?: string; canBeUsedToMatch?: boolean; [key: string]: unknown };
type ResourceMapperCommon = { matchingColumns?: string[]; cachedResultName?: string; [key: string]: unknown };
type ResourceMapperValue = ResourceMapperCommon & { mappingMode: string; value?: null | Record<string, unknown>; schema?: ResourceMapperField[] };

interface Credentials {
  airtableTokenApi: CredentialReference;
  airtableOAuth2Api: CredentialReference;
}

/** Update a record in a table */
export type AirtableV22RecordUpdateParams = {
  resource: 'record';
  operation: 'update';
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
 * Columns
 * @default {"mappingMode":"defineBelow","value":null}
 */
    columns?: ResourceMapperValue;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Whether the Airtable API should attempt mapping of string values for linked records & select options
     * @default false
     */
    typecast?: boolean | Expression<boolean>;
    /** Comma-separated list of fields in input to ignore when updating
     * @displayOptions.show { /columns.mappingMode: ["autoMapInputData"] }
     */
    ignoreFields?: string | Expression<string>;
    /** Whether to update all records matching the value in the "Column to Match On". If not set, only the first matching record will be updated.
     * @default false
     */
    updateAllMatches?: boolean | Expression<boolean>;
  };
};

export type AirtableV22RecordUpdateNode = {
  type: 'n8n-nodes-base.airtable';
  version: 2.2;
  config: NodeConfig<AirtableV22RecordUpdateParams> & { credentials?: Credentials };
};
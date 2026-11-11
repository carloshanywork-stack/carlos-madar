/**
 * Airtable Node - Version 2.2
 * Discriminator: resource=record, operation=create
 */


// Helper types for special n8n fields
type ResourceMapperField = { id?: string; displayName?: string; required?: boolean; defaultMatch?: boolean; display?: boolean; type?: string; canBeUsedToMatch?: boolean; [key: string]: unknown };
type ResourceMapperCommon = { matchingColumns?: string[]; cachedResultName?: string; [key: string]: unknown };
type ResourceMapperValue = ResourceMapperCommon & { mappingMode: string; value?: null | Record<string, unknown>; schema?: ResourceMapperField[] };

interface Credentials {
  airtableTokenApi: CredentialReference;
  airtableOAuth2Api: CredentialReference;
}

/** Create a new record in a table */
export type AirtableV22RecordCreateParams = {
  resource: 'record';
  operation: 'create';
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
  };
};

export type AirtableV22RecordCreateNode = {
  type: 'n8n-nodes-base.airtable';
  version: 2.2;
  config: NodeConfig<AirtableV22RecordCreateParams> & { credentials?: Credentials };
};
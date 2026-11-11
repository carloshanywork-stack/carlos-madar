/**
 * Airtable Node - Version 2.1
 * Discriminator: resource=base, operation=getMany
 */


interface Credentials {
  airtableTokenApi: CredentialReference;
  airtableOAuth2Api: CredentialReference;
}

/** List all the bases */
export type AirtableV21BaseGetManyParams = {
  resource: 'base';
  operation: 'getMany';
  authentication?: 'airtableTokenApi' | 'airtableOAuth2Api' | Expression<string>;
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
 * Options
 * @default {}
 */
    options?: {
    /** Filter the returned bases by one or more permission levels
     * @default []
     */
    permissionLevel?: Array<'comment' | 'create' | 'edit' | 'none' | 'read'>;
  };
};

export type AirtableV21BaseGetManyNode = {
  type: 'n8n-nodes-base.airtable';
  version: 2.1;
  config: NodeConfig<AirtableV21BaseGetManyParams> & { credentials?: Credentials };
};
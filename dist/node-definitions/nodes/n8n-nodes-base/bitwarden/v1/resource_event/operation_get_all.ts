/**
 * Bitwarden Node - Version 1
 * Discriminator: resource=event, operation=getAll
 */


interface Credentials {
  bitwardenApi: CredentialReference;
}

export type BitwardenV1EventGetAllParams = {
  resource: 'event';
  operation: 'getAll';
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 10
 */
    limit?: number | Expression<number>;
/**
 * Filters
 * @default {}
 */
    filters?: {
    /** The unique identifier of the acting user
     */
    actingUserId?: string | Expression<string>;
    /** The end date for the search
     */
    end?: string | Expression<string>;
    /** The unique identifier of the item that the event describes
     */
    itemID?: string | Expression<string>;
    /** The start date for the search
     */
    start?: string | Expression<string>;
  };
};

export type BitwardenV1EventGetAllNode = {
  type: 'n8n-nodes-base.bitwarden';
  version: 1;
  config: NodeConfig<BitwardenV1EventGetAllParams> & { credentials?: Credentials };
};
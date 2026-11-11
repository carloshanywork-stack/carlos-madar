/**
 * Cockpit Node - Version 1
 * Discriminator: resource=collection, operation=getAll
 */


interface Credentials {
  cockpitApi: CredentialReference;
}

/** Get many collection entries */
export type CockpitV1CollectionGetAllParams = {
  resource: 'collection';
  operation: 'getAll';
/**
 * Name of the collection to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getCollections
 */
    collection: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
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
    /** Comma-separated list of fields to get
     */
    fields?: string | Expression<string>;
    /** Filter query in &lt;a href="https://jeroen.github.io/mongolite/query-data.html"&gt;Mongolite format&lt;/a&gt;
     */
    filter?: IDataObject | string | Expression<string>;
    /** Return normalized language fields
     */
    language?: string | Expression<string>;
    /** Whether to resolve linked collection items
     * @default true
     */
    populate?: boolean | Expression<boolean>;
    /** Whether to return the data exactly in the way it got received from the API
     * @default false
     */
    rawData?: boolean | Expression<boolean>;
    /** Skip number of entries
     */
    skip?: number | Expression<number>;
    /** Sort query in &lt;a href="https://jeroen.github.io/mongolite/query-data.html"&gt;Mongolite format&lt;/a&gt;
     */
    sort?: IDataObject | string | Expression<string>;
  };
};

export type CockpitV1CollectionGetAllNode = {
  type: 'n8n-nodes-base.cockpit';
  version: 1;
  config: NodeConfig<CockpitV1CollectionGetAllParams> & { credentials?: Credentials };
};
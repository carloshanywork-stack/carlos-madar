/**
 * Bubble Node - Version 1
 * Discriminator: resource=object, operation=getAll
 */


interface Credentials {
  bubbleApi: CredentialReference;
}

export type BubbleV1ObjectGetAllParams = {
  resource: 'object';
  operation: 'getAll';
/**
 * Name of data type of the object to create
 */
    typeName: string | Expression<string>;
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
 * JSON Parameters
 * @default false
 */
    jsonParameters?: boolean | Expression<boolean>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Filters
     * @displayOptions.show { /jsonParameters: [false] }
     * @default {}
     */
    filters?: {
        /** Filter
     */
    filter?: Array<{
      /** Field to set for the object to create
       */
      key?: string | Expression<string>;
      /** Constrain
       */
      constraint_type?: 'equals' | 'not equal' | 'is_empty' | 'is_not_empty' | 'text contains' | 'not text contains' | 'greater than' | 'less than' | 'in' | 'not in' | 'contains' | 'not contains' | 'empty' | 'not empty' | 'geographic_search' | Expression<string>;
      /** Value to set for the object to create
       * @displayOptions.hide { constraint_type: ["is_empty", "is_not_empty", "empty", "not empty"] }
       */
      value?: string | Expression<string>;
    }>;
  };
    /** Refine the list that is returned by the Data API with search constraints, exactly as you define a search in Bubble. See &lt;a href="https://manual.bubble.io/core-resources/api/the-bubble-api/the-data-api/data-api-requests#constraint-types"&gt;link&lt;/a&gt;.
     * @displayOptions.show { /jsonParameters: [true] }
     */
    filtersJson?: IDataObject | string | Expression<string>;
    /** Sort
     * @default {}
     */
    sort?: {
        /** Sort
     */
    sortValue?: {
      /** Specify the field to use for sorting. Either use a fielddefined for the current typeor use &lt;code&gt;_random_sorting&lt;/code&gt; to get the entries in a random order.
       */
      sort_field?: string | Expression<string>;
      /** Descending
       * @default false
       */
      descending?: boolean | Expression<boolean>;
      /** When the field's type is geographic address, you need to add another parameter geo_reference and provide an address as a string
       */
      geo_reference?: string | Expression<string>;
    };
  };
  };
};

export type BubbleV1ObjectGetAllOutput = {
  _id?: string;
  'Created By'?: string;
  'Created Date'?: string;
  'Modified Date'?: string;
};

export type BubbleV1ObjectGetAllNode = {
  type: 'n8n-nodes-base.bubble';
  version: 1;
  config: NodeConfig<BubbleV1ObjectGetAllParams> & { credentials?: Credentials };
  output?: Items<BubbleV1ObjectGetAllOutput>;
};
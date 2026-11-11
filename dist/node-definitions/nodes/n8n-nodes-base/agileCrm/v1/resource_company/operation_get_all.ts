/**
 * Agile CRM Node - Version 1
 * Discriminator: resource=company, operation=getAll
 */


interface Credentials {
  agileCrmApi: CredentialReference;
}

/** Get many contacts */
export type AgileCrmV1CompanyGetAllParams = {
  resource: 'company';
  operation: 'getAll';
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 20
 */
    limit?: number | Expression<number>;
/**
 * Filter
 * @default none
 */
    filterType?: 'none' | 'manual' | 'json' | Expression<string>;
/**
 * Must Match
 * @displayOptions.show { filterType: ["manual"] }
 * @default anyFilter
 */
    matchType?: 'anyFilter' | 'allFilters' | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default false
 */
    simple?: boolean | Expression<boolean>;
/**
 * Filters
 * @displayOptions.show { filterType: ["manual"] }
 * @default {}
 */
    filters?: {
        /** Conditions
     */
    conditions?: Array<{
      /** Any searchable field
       */
      field?: string | Expression<string>;
      /** Condition Type
       * @default EQUALS
       */
      condition_type?: 'AFTER' | 'BEFORE' | 'BETWEEN' | 'EQUALS' | 'LAST' | 'NOTEQUALS' | 'ON' | Expression<string>;
      /** Value
       */
      value?: string | Expression<string>;
      /** Value 2
       * @displayOptions.show { condition_type: ["BETWEEN"] }
       */
      value2?: string | Expression<string>;
    }>;
  };
/**
 * Filters (JSON)
 * @displayOptions.show { filterType: ["json"] }
 */
    filterJson?: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Sort
     * @default []
     */
    sort?: {
        /** Sort
     */
    sort?: {
      /** The sorting direction
       * @default ASC
       */
      direction?: 'ASC' | 'DESC' | Expression<string>;
      /** The sorting field
       */
      field?: string | Expression<string>;
    };
  };
  };
};

export type AgileCrmV1CompanyGetAllNode = {
  type: 'n8n-nodes-base.agileCrm';
  version: 1;
  config: NodeConfig<AgileCrmV1CompanyGetAllParams> & { credentials?: Credentials };
};
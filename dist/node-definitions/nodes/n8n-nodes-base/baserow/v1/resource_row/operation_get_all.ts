/**
 * Baserow Node - Version 1
 * Discriminator: resource=row, operation=getAll
 */


interface Credentials {
  baserowApi: CredentialReference;
  baserowTokenApi: CredentialReference;
}

/** Retrieve many rows */
export type BaserowV1RowGetAllParams = {
  resource: 'row';
  operation: 'getAll';
  authentication?: 'usernamePassword' | 'databaseToken' | Expression<string>;
/**
 * Database to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getDatabaseIds
 * @displayOptions.hide { authentication: ["databaseToken"] }
 * @default 0
 */
    databaseId?: string | Expression<string>;
/**
 * Table to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTableIds
 */
    tableId: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 50
 */
    limit?: number | Expression<number>;
/**
 * Options
 * @default {}
 */
    additionalOptions?: {
    /** Filter rows based on comparison operators
     * @default {}
     */
    filters?: {
        /** Field
     */
    fields?: Array<{
      /** Field to compare. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
       * @loadOptionsMethod getTableFields
       */
      field?: string | Expression<string>;
      /** Operator to compare field and value with
       * @default equal
       */
      operator?: 'equal' | 'not_equal' | 'contains' | 'contains_not' | 'contains_word' | 'doesnt_contain_word' | 'length_is_lower_than' | 'higher_than' | 'higher_than_or_equal' | 'lower_than' | 'lower_than_or_equal' | 'is_even_and_whole' | 'date_is' | 'date_is_not' | 'date_is_before' | 'date_is_on_or_before' | 'date_is_after' | 'date_is_on_or_after' | 'date_is_within' | 'date_equals_today' | 'date_equals_month' | 'date_equals_year' | 'date_equals_day_of_month' | 'date_equal' | 'date_not_equal' | 'date_before' | 'date_before_or_equal' | 'date_after' | 'date_after_or_equal' | 'date_after_days_ago' | 'date_within_days' | 'date_within_weeks' | 'date_within_months' | 'date_equals_days_ago' | 'date_equals_months_ago' | 'date_equals_years_ago' | 'date_before_today' | 'date_after_today' | 'date_equals_week' | 'filename_contains' | 'has_file_type' | 'files_lower_than' | 'single_select_equal' | 'single_select_not_equal' | 'single_select_is_any_of' | 'single_select_is_none_of' | 'multiple_select_has' | 'multiple_select_has_not' | 'multiple_collaborators_has' | 'multiple_collaborators_has_not' | 'user_is' | 'user_is_not' | 'link_row_has' | 'link_row_has_not' | 'link_row_contains' | 'link_row_not_contains' | 'boolean' | 'empty' | 'not_empty' | Expression<string>;
      /** Timezone used for date filter evaluation, e.g. UTC or Europe/Berlin
       * @displayOptions.show { operator: ["date_is", "date_is_not", "date_is_before", "date_is_on_or_before", "date_is_after", "date_is_on_or_after", "date_is_within", "date_within_days", "date_within_weeks", "date_within_months", "date_equals_days_ago", "date_equals_months_ago", "date_equals_years_ago", "date_equals_today", "date_before_today", "date_after_today", "date_equals_week", "date_equals_month", "date_equals_year"] }
       * @default UTC
       */
      timezone?: string | Expression<string>;
      /** Value to compare to. For date filters, enter a date as YYYY-MM-DD.
       */
      value?: string | Expression<string>;
    }>;
  };
    /** This works only if two or more filters are provided. Defaults to &lt;code&gt;AND&lt;/code&gt;
     * @default AND
     */
    filterType?: 'AND' | 'OR' | Expression<string>;
    /** Text to match (can be in any column)
     */
    search?: string | Expression<string>;
    /** Set the sort order of the result rows
     * @default {}
     */
    order?: {
        /** Field
     */
    fields?: Array<{
      /** Field name to sort by. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
       * @loadOptionsMethod getTableFields
       */
      field?: string | Expression<string>;
      /** Sort direction, either ascending or descending
       */
      direction?: '' | '-' | Expression<string>;
    }>;
  };
  };
};

export type BaserowV1RowGetAllNode = {
  type: 'n8n-nodes-base.baserow';
  version: 1;
  config: NodeConfig<BaserowV1RowGetAllParams> & { credentials?: Credentials };
};
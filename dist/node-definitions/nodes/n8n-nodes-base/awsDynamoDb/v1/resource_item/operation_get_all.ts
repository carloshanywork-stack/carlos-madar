/**
 * AWS DynamoDB Node - Version 1
 * Discriminator: resource=item, operation=getAll
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get many items */
export type AwsDynamoDbV1ItemGetAllParams = {
  resource: 'item';
  operation: 'getAll';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Table to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTables
 * @default []
 */
    tableName?: string | Expression<string>;
/**
 * Whether to do an scan or query. Check &lt;a href="https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-query-scan.html" &gt;differences&lt;/a&gt;.
 * @default false
 */
    scan?: boolean | Expression<boolean>;
/**
 * A filter expression determines which items within the Scan results should be returned to you. All of the other results are discarded. Empty value will return all Scan results.
 * @displayOptions.show { scan: [true] }
 */
    filterExpression?: string | Expression<string>;
/**
 * Condition to determine the items to be retrieved. The condition must perform an equality test on a single partition key value, in this format: &lt;code&gt;partitionKeyName = :partitionkeyval&lt;/code&gt;
 * @displayOptions.show { scan: [false] }
 * @required when the displayOptions conditions above match
 */
    keyConditionExpression?: string | Expression<string>;
/**
 * Substitution tokens for attribute names in an expression
 * @default {}
 */
    eavUi?: {
        /** Expression Attribute Vaue
     */
    eavValues?: Array<{
      /** Attribute
       */
      attribute?: string | Expression<string>;
      /** Type
       * @default S
       */
      type?: 'N' | 'S' | Expression<string>;
      /** Value
       */
      value?: string | Expression<string>;
    }>;
  };
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
 * Select
 * @default ALL_ATTRIBUTES
 */
    select?: 'ALL_ATTRIBUTES' | 'ALL_PROJECTED_ATTRIBUTES' | 'COUNT' | 'SPECIFIC_ATTRIBUTES' | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @displayOptions.show { select: ["ALL_PROJECTED_ATTRIBUTES", "ALL_ATTRIBUTES", "SPECIFIC_ATTRIBUTES"] }
 * @default true
 */
    simple?: boolean | Expression<boolean>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Name of the index to query. It can be any secondary local or global index on the table.
     */
    indexName?: string | Expression<string>;
    /** Text that identifies one or more attributes to retrieve from the table. These attributes can include scalars, sets, or elements of a JSON document. The attributes in the expression must be separated by commas.
     */
    projectionExpression?: string | Expression<string>;
    /** Text that contains conditions that DynamoDB applies after the Query operation, but before the data is returned. Items that do not satisfy the FilterExpression criteria are not returned.
     * @displayOptions.show { /scan: [false] }
     */
    filterExpression?: string | Expression<string>;
    /** One or more substitution tokens for attribute names in an expression. Check &lt;a href="https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html"&gt;Info&lt;/a&gt;.
     * @default {}
     */
    eanUi?: {
        /** Expression
     */
    eanValues?: Array<{
      /** Key
       */
      key?: string | Expression<string>;
      /** Value
       */
      value?: string | Expression<string>;
    }>;
  };
  };
};

export type AwsDynamoDbV1ItemGetAllOutput = {
  name?: string;
};

export type AwsDynamoDbV1ItemGetAllNode = {
  type: 'n8n-nodes-base.awsDynamoDb';
  version: 1;
  config: NodeConfig<AwsDynamoDbV1ItemGetAllParams> & { credentials?: Credentials };
  output?: Items<AwsDynamoDbV1ItemGetAllOutput>;
};
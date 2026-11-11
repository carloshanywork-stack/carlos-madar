/**
 * AWS DynamoDB Node - Version 1
 * Discriminator: resource=item, operation=get
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Get an item */
export type AwsDynamoDbV1ItemGetParams = {
  resource: 'item';
  operation: 'get';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Table to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTables
 * @default []
 */
    tableName?: string | Expression<string>;
/**
 * Select
 * @default ALL_ATTRIBUTES
 */
    select?: 'ALL_ATTRIBUTES' | 'ALL_PROJECTED_ATTRIBUTES' | 'SPECIFIC_ATTRIBUTES' | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @displayOptions.show { select: ["ALL_PROJECTED_ATTRIBUTES", "ALL_ATTRIBUTES"] }
 * @default true
 */
    simple?: boolean | Expression<boolean>;
/**
 * Item's primary key. For example, with a simple primary key, you only need to provide a value for the partition key. For a composite primary key, you must provide values for both the partition key and the sort key.
 * @default {}
 */
    keysUi?: {
        /** Key
     */
    keyValues?: Array<{
      /** Key
       */
      key?: string | Expression<string>;
      /** Type
       * @default S
       */
      type?: 'B' | 'N' | 'S' | Expression<string>;
      /** Value
       */
      value?: string | Expression<string>;
    }>;
  };
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Attributes to Select
     */
    projectionExpression?: string | Expression<string>;
    /** One or more substitution tokens for attribute names in an expression. &lt;a href="https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html"&gt;View details&lt;/a&gt;.
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
    /** Type of read to perform on the table. &lt;a href="https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html"&gt;View details&lt;/a&gt;.
     * @default eventuallyConsistentRead
     */
    readType?: 'stronglyConsistentRead' | 'eventuallyConsistentRead' | Expression<string>;
  };
/**
 * A filter expression determines which items within the Scan results should be returned to you. All of the other results are discarded. Empty value will return all Scan results.
 * @displayOptions.show { scan: [true] }
 */
    filterExpression?: string | Expression<string>;
};

export type AwsDynamoDbV1ItemGetNode = {
  type: 'n8n-nodes-base.awsDynamoDb';
  version: 1;
  config: NodeConfig<AwsDynamoDbV1ItemGetParams> & { credentials?: Credentials };
};
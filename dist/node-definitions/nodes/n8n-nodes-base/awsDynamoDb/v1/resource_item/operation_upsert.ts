/**
 * AWS DynamoDB Node - Version 1
 * Discriminator: resource=item, operation=upsert
 */


interface Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

/** Create a new record, or update the current one if it already exists (upsert) */
export type AwsDynamoDbV1ItemUpsertParams = {
  resource: 'item';
  operation: 'upsert';
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
/**
 * Table to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTables
 * @default []
 */
    tableName?: string | Expression<string>;
/**
 * Whether to insert the input data this node receives in the new row
 * @default defineBelow
 */
    dataToSend?: 'autoMapInputData' | 'defineBelow' | Expression<string>;
/**
 * Whether to convert number-looking string values to DynamoDB Number (N). Disable to keep strings as String (S).
 * @default true
 */
    autoParseNumbers?: boolean | Expression<boolean>;
/**
 * List of input properties to avoid sending, separated by commas. Leave empty to send all properties.
 * @displayOptions.show { dataToSend: ["autoMapInputData"] }
 */
    inputsToIgnore?: string | Expression<string>;
/**
 * Fields to Send
 * @displayOptions.show { dataToSend: ["defineBelow"] }
 * @default {}
 */
    fieldsUi?: {
        /** Field
     */
    fieldValues?: Array<{
      /** Field ID
       */
      fieldId?: string | Expression<string>;
      /** Field Value
       */
      fieldValue?: string | Expression<string>;
    }>;
  };
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Substitution tokens for attribute names in an expression. Only needed when the parameter "condition expression" is set.
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
    /** A condition that must be satisfied in order for a conditional upsert to succeed. &lt;a href="https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html"&gt;View details&lt;/a&gt;.
     */
    conditionExpression?: string | Expression<string>;
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
  };
/**
 * A filter expression determines which items within the Scan results should be returned to you. All of the other results are discarded. Empty value will return all Scan results.
 * @displayOptions.show { scan: [true] }
 */
    filterExpression?: string | Expression<string>;
};

export type AwsDynamoDbV1ItemUpsertNode = {
  type: 'n8n-nodes-base.awsDynamoDb';
  version: 1;
  config: NodeConfig<AwsDynamoDbV1ItemUpsertParams> & { credentials?: Credentials };
};
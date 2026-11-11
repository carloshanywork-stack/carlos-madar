/**
 * Agile CRM Node - Version 1
 * Discriminator: resource=deal, operation=create
 */


interface Credentials {
  agileCrmApi: CredentialReference;
}

/** Create a new contact */
export type AgileCrmV1DealCreateParams = {
  resource: 'deal';
  operation: 'create';
/**
 * Closing date of deal
 * @displayOptions.show { jsonParameters: [false] }
 * @required when the displayOptions conditions above match
 */
    closeDate?: string | Expression<string>;
/**
 * Expected Value of deal
 * @displayOptions.show { jsonParameters: [false] }
 * @default 1
 */
    expectedValue?: number | Expression<number>;
/**
 * Milestone of deal
 * @displayOptions.show { jsonParameters: [false] }
 * @required when the displayOptions conditions above match
 */
    milestone?: string | Expression<string>;
/**
 * Name of deal
 * @displayOptions.show { jsonParameters: [false] }
 * @required when the displayOptions conditions above match
 */
    name?: string | Expression<string>;
/**
 * Expected probability
 * @displayOptions.show { jsonParameters: [false] }
 * @default 50
 */
    probability?: number | Expression<number>;
/**
 * JSON Parameters
 * @default false
 */
    jsonParameters?: boolean | Expression<boolean>;
/**
 * Object of values to set as described &lt;a href="https://github.com/agilecrm/rest-api#1-deals---companies-api"&gt;here&lt;/a&gt;
 * @displayOptions.show { jsonParameters: [true] }
 */
    additionalFieldsJson?: IDataObject | string | Expression<string>;
/**
 * Additional Fields
 * @displayOptions.show { jsonParameters: [false] }
 * @default {}
 */
    additionalFields?: {
    /** Unique contact identifiers
     * @default []
     */
    contactIds?: Array<string | Expression<string>>;
    /** Custom Data
     * @default {}
     */
    customData?: {
        /** Property
     */
    customProperty?: Array<{
      /** Property name
       */
      name?: string | Expression<string>;
      /** Property value
       */
      value?: string | Expression<string>;
    }>;
  };
  };
};

export type AgileCrmV1DealCreateNode = {
  type: 'n8n-nodes-base.agileCrm';
  version: 1;
  config: NodeConfig<AgileCrmV1DealCreateParams> & { credentials?: Credentials };
};
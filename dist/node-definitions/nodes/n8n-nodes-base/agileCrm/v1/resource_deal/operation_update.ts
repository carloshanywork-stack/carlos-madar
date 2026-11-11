/**
 * Agile CRM Node - Version 1
 * Discriminator: resource=deal, operation=update
 */


interface Credentials {
  agileCrmApi: CredentialReference;
}

/** Update contact properties */
export type AgileCrmV1DealUpdateParams = {
  resource: 'deal';
  operation: 'update';
/**
 * ID of deal to update
 */
    dealId: string | Expression<string>;
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
    /** Expected Value of deal
     */
    expectedValue?: number | Expression<number>;
    /** Name of deal
     */
    name?: string | Expression<string>;
    /** Expected Value of deal
     * @default 50
     */
    probability?: number | Expression<number>;
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

export type AgileCrmV1DealUpdateNode = {
  type: 'n8n-nodes-base.agileCrm';
  version: 1;
  config: NodeConfig<AgileCrmV1DealUpdateParams> & { credentials?: Credentials };
};
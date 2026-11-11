/**
 * Agile CRM Node - Version 1
 * Discriminator: resource=contact, operation=create
 */


interface Credentials {
  agileCrmApi: CredentialReference;
}

/** Create a new contact */
export type AgileCrmV1ContactCreateParams = {
  resource: 'contact';
  operation: 'create';
/**
 * JSON Parameters
 * @default false
 */
    jsonParameters?: boolean | Expression<boolean>;
/**
 * Object of values to set as described &lt;a href="https://github.com/agilecrm/rest-api#1-contacts---companies-api"&gt;here&lt;/a&gt;
 * @displayOptions.show { jsonParameters: [true] }
 */
    additionalFieldsJson?: IDataObject | string | Expression<string>;
/**
 * Additional Fields
 * @displayOptions.show { jsonParameters: [false] }
 * @default {}
 */
    additionalFields?: {
    /** Contacts address
     * @default {}
     */
    addressOptions?: {
        /** Address Properties
     */
    addressProperties?: Array<{
      /** Type of address
       */
      subtype?: 'home' | 'postal' | 'office' | Expression<string>;
      /** Full address
       */
      address?: string | Expression<string>;
    }>;
  };
    /** Company Name
     */
    company?: string | Expression<string>;
    /** Contact email
     * @default {}
     */
    emailOptions?: {
        /** Email Properties
     */
    emailProperties?: Array<{
      /** Type of Email
       */
      subtype?: 'work' | 'personal' | Expression<string>;
      /** Email
       */
      email?: string | Expression<string>;
    }>;
  };
    /** Contact first name
     */
    firstName?: string | Expression<string>;
    /** Contact last name
     */
    lastName?: string | Expression<string>;
    /** Lead score of contact
     */
    leadScore?: number | Expression<number>;
    /** Rating of contact (Max value 5). This is not applicable for companies.
     */
    starValue?: 0 | 1 | 2 | 3 | 4 | 5 | Expression<number>;
    /** Contacts phone
     * @default {}
     */
    phoneOptions?: {
        /** Phone Properties
     */
    phoneProperties?: Array<{
      /** Type of phone number
       */
      subtype?: 'home' | 'homeFax' | 'main' | 'mobile' | 'other' | 'work' | 'workFax' | Expression<string>;
      /** Phone number
       */
      number?: string | Expression<string>;
    }>;
  };
    /** Unique identifiers added to contact, for easy management of contacts. This is not applicable for companies.
     * @default []
     */
    tags?: Array<string | Expression<string>>;
    /** Professional title
     */
    title?: string | Expression<string>;
    /** Contacts websites
     * @default {}
     */
    websiteOptions?: {
        /** Website Properties.
     */
    websiteProperties?: Array<{
      /** Type of website
       */
      subtype?: 'facebook' | 'feed' | 'flickr' | 'github' | 'googlePlus' | 'linkedin' | 'skype' | 'twitter' | 'url' | 'xing' | 'youtube' | Expression<string>;
      /** Website URL
       */
      url?: string | Expression<string>;
    }>;
  };
    /** Custom Properties
     * @default {}
     */
    customProperties?: {
        /** Property
     */
    customProperty?: Array<{
      /** Property name
       */
      name?: string | Expression<string>;
      /** Property sub type
       */
      subtype?: string | Expression<string>;
      /** Property value
       */
      value?: string | Expression<string>;
    }>;
  };
  };
};

export type AgileCrmV1ContactCreateNode = {
  type: 'n8n-nodes-base.agileCrm';
  version: 1;
  config: NodeConfig<AgileCrmV1ContactCreateParams> & { credentials?: Credentials };
};
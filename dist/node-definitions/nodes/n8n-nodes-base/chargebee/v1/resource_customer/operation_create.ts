/**
 * Chargebee Node - Version 1
 * Discriminator: resource=customer, operation=create
 */


interface Credentials {
  chargebeeApi: CredentialReference;
}

/** Create a customer */
export type ChargebeeV1CustomerCreateParams = {
  resource: 'customer';
  operation: 'create';
/**
 * Properties to set on the new user
 * @default {}
 */
    properties?: {
    /** ID for the new customer. If not given, this will be auto-generated.
     */
    id?: string | Expression<string>;
    /** The first name of the customer
     */
    first_name?: string | Expression<string>;
    /** The last name of the customer
     */
    last_name?: string | Expression<string>;
    /** The email address of the customer
     */
    email?: string | Expression<string>;
    /** The phone number of the customer
     */
    phone?: string | Expression<string>;
    /** The company of the customer
     */
    company?: string | Expression<string>;
    /** Adds a custom property to set also values which have not been predefined
     * @default {}
     */
    customProperties?: {
        /** Property
     */
    property?: Array<{
      /** Name of the property to set
       */
      name?: string | Expression<string>;
      /** Value of the property to set
       */
      value?: string | Expression<string>;
    }>;
  };
  };
};

export type ChargebeeV1CustomerCreateNode = {
  type: 'n8n-nodes-base.chargebee';
  version: 1;
  config: NodeConfig<ChargebeeV1CustomerCreateParams> & { credentials?: Credentials };
};
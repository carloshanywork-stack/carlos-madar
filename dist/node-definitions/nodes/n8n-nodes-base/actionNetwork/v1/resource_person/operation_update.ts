/**
 * Action Network Node - Version 1
 * Discriminator: resource=person, operation=update
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1PersonUpdateParams = {
  resource: 'person';
  operation: 'update';
/**
 * ID of the person to update
 */
    personId: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Person’s last name
     */
    family_name?: string | Expression<string>;
    /** Person’s first name
     */
    given_name?: string | Expression<string>;
    /** Language spoken by the person
     * @default []
     */
    languages_spoken?: 'da' | 'nl' | 'en' | 'fi' | 'fr' | 'de' | 'hu' | 'id' | 'ja' | 'pt' | 'br' | 'ru' | 'es' | 'sv' | 'tr' | 'cy' | Expression<string>;
    /** Phone Number
     * @default {}
     */
    phone_numbers?: {
        /** Phone Numbers Fields
     */
    phone_numbers_fields?: {
      /** Person's mobile number, in international format without the plus sign
       */
      number?: string | Expression<string>;
      /** Whether this is the person's primary phone number
       * @default true
       */
      primary?: unknown;
      /** Subscription status of this number
       * @default subscribed
       */
      status?: 'bouncing' | 'previous bounce' | 'subscribed' | 'unsubscribed' | Expression<string>;
    };
  };
    /** Postal Addresses
     * @default {}
     */
    postal_addresses?: {
        /** Postal Addresses Fields
     */
    postal_addresses_fields?: Array<{
      /** Whether this is the person's primary address
       * @default false
       */
      primary?: boolean | Expression<boolean>;
      /** Line for a person's address
       */
      address_lines?: string | Expression<string>;
      /** City or other local administrative area. If blank, this will be filled in based on Action Network's geocoding.
       */
      locality?: string | Expression<string>;
      /** State or subdivision code per ISO 3166-2
       */
      region?: string | Expression<string>;
      /** Region specific postal code, such as ZIP code
       */
      postal_code?: string | Expression<string>;
      /** Country code according to ISO 3166-1 Alpha-2. Defaults to US.
       */
      country?: string | Expression<string>;
      /** Language in which the address is recorded, per ISO 639
       */
      language?: string | Expression<string>;
      /** Location
       * @default {}
       */
      location?: {
        /** Location Fields
     */
    location_fields?: {
      /** Latitude of the location of the address
       */
      latitude?: string | Expression<string>;
      /** Longitude of the location of the address
       */
      longitude?: string | Expression<string>;
    };
  };
    }>;
  };
  };
};

export type ActionNetworkV1PersonUpdateNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1PersonUpdateParams> & { credentials?: Credentials };
};
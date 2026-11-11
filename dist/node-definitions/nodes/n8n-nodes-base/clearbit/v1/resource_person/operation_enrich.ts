/**
 * Clearbit Node - Version 1
 * Discriminator: resource=person, operation=enrich
 */


interface Credentials {
  clearbitApi: CredentialReference;
}

/** The Person API lets you retrieve social information associated with an email address, such as a person’s name, location and Twitter handle */
export type ClearbitV1PersonEnrichParams = {
  resource: 'person';
  operation: 'enrich';
/**
 * The email address to look up
 */
    email: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The name of the person’s employer
     */
    company?: string | Expression<string>;
    /** The domain for the person’s employer
     */
    companyDomain?: string | Expression<string>;
    /** The Facebook URL for the person
     */
    facebook?: string | Expression<string>;
    /** Last name of person. If you have this, passing this is strongly recommended to improve match rates.
     */
    familyName?: string | Expression<string>;
    /** First name of person
     */
    givenName?: string | Expression<string>;
    /** IP address of the person. If you have this, passing this is strongly recommended to improve match rates.
     */
    ipAddress?: string | Expression<string>;
    /** The city or country where the person resides
     */
    location?: string | Expression<string>;
    /** The LinkedIn URL for the person
     */
    linkedIn?: string | Expression<string>;
    /** The Twitter handle for the person
     */
    twitter?: string | Expression<string>;
  };
};

export type ClearbitV1PersonEnrichOutput = {
  bio?: null;
  email?: string;
  emailProvider?: boolean;
  employment?: {
    domain?: string;
    name?: string;
  };
  facebook?: {
    handle?: null;
  };
  fuzzy?: boolean;
  googleplus?: {
    handle?: null;
  };
  gravatar?: {
    avatars?: Array<{
      type?: string;
      url?: string;
    }>;
  };
  id?: string;
  inactiveAt?: null;
  indexedAt?: string;
  name?: {
    familyName?: string;
    fullName?: string;
    givenName?: string;
  };
  site?: null;
  twitter?: {
    avatar?: null;
    bio?: null;
    favorites?: null;
    followers?: null;
    following?: null;
    handle?: null;
    id?: null;
    location?: null;
    site?: null;
    statuses?: null;
  };
};

export type ClearbitV1PersonEnrichNode = {
  type: 'n8n-nodes-base.clearbit';
  version: 1;
  config: NodeConfig<ClearbitV1PersonEnrichParams> & { credentials?: Credentials };
  output?: Items<ClearbitV1PersonEnrichOutput>;
};
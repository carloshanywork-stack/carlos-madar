/**
 * Bitly Node - Version 1
 * Discriminator: resource=link, operation=create
 */


interface Credentials {
  bitlyApi: CredentialReference;
  bitlyOAuth2Api: CredentialReference;
}

/** Create a link */
export type BitlyV1LinkCreateParams = {
  resource: 'link';
  operation: 'create';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Long URL
 */
    longUrl: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Domain
     * @default bit.ly
     */
    domain?: string | Expression<string>;
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getGroups
     */
    group?: string | Expression<string>;
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getTags
     * @default []
     */
    tags?: string[];
    /** Title
     */
    title?: string | Expression<string>;
  };
/**
 * Deeplinks
 * @default {}
 */
    deeplink?: {
        /** Deep Link
     */
    deeplinkUi?: Array<{
      /** App ID
       */
      appId?: string | Expression<string>;
      /** App URI Path
       */
      appUriPath?: string | Expression<string>;
      /** Install Type
       */
      installType?: string | Expression<string>;
      /** Install URL
       */
      installUrl?: string | Expression<string>;
    }>;
  };
};

export type BitlyV1LinkCreateOutput = {
  archived?: boolean;
  created_at?: string;
  id?: string;
  link?: string;
  long_url?: string;
  references?: {
    group?: string;
  };
  tags?: Array<string>;
};

export type BitlyV1LinkCreateNode = {
  type: 'n8n-nodes-base.bitly';
  version: 1;
  config: NodeConfig<BitlyV1LinkCreateParams> & { credentials?: Credentials };
  output?: Items<BitlyV1LinkCreateOutput>;
};
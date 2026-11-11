/**
 * Bitly Node - Version 1
 * Discriminator: resource=link, operation=update
 */


interface Credentials {
  bitlyApi: CredentialReference;
  bitlyOAuth2Api: CredentialReference;
}

/** Update a link */
export type BitlyV1LinkUpdateParams = {
  resource: 'link';
  operation: 'update';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Bitlink
 */
    id: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Archived
     * @default false
     */
    archived?: boolean | Expression<boolean>;
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getGroups
     */
    group?: string | Expression<string>;
    /** Long URL
     */
    longUrl?: string | Expression<string>;
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

export type BitlyV1LinkUpdateNode = {
  type: 'n8n-nodes-base.bitly';
  version: 1;
  config: NodeConfig<BitlyV1LinkUpdateParams> & { credentials?: Credentials };
};
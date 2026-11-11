/**
 * Airtop Node - Version 1.1
 * Discriminator: resource=window, operation=load
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Load a URL in an existing window */
export type AirtopV11WindowLoadParams = {
  resource: 'window';
  operation: 'load';
/**
 * The ID of the &lt;a href="https://docs.airtop.ai/guides/how-to/creating-a-session" target="_blank"&gt;Session&lt;/a&gt; to use
 * @default ={{ $json["sessionId"] }}
 */
    sessionId?: string | Expression<string>;
/**
 * The ID of the &lt;a href="https://docs.airtop.ai/guides/how-to/creating-a-session#windows" target="_blank"&gt;Window&lt;/a&gt; to use
 * @default ={{ $json["windowId"] }}
 */
    windowId?: string | Expression<string>;
/**
 * URL to load in the window
 */
    url: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Wait until the specified loading event occurs. Defaults to 'Fully Loaded'.
     * @default load
     */
    waitUntil?: 'complete' | 'domContentLoaded' | 'load' | 'noWait' | Expression<string>;
  };
};

export type AirtopV11WindowLoadNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1.1;
  config: NodeConfig<AirtopV11WindowLoadParams> & { credentials?: Credentials };
};
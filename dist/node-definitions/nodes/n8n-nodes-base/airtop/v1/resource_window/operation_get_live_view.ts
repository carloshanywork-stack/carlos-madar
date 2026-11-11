/**
 * Airtop Node - Version 1
 * Discriminator: resource=window, operation=getLiveView
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Get information about a browser window, including the live view URL */
export type AirtopV1WindowGetLiveViewParams = {
  resource: 'window';
  operation: 'getLiveView';
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
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Whether to include the navigation bar in the Live View. When enabled, the navigation bar will be visible allowing you to navigate between pages.
     * @default false
     */
    includeNavigationBar?: boolean | Expression<boolean>;
    /** The screen resolution of the Live View. Setting a resolution will force the window to open at that specific size.
     */
    screenResolution?: string | Expression<string>;
    /** Whether to disable the window from being resized in the Live View
     * @default false
     */
    disableResize?: boolean | Expression<boolean>;
  };
};

export type AirtopV1WindowGetLiveViewNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1WindowGetLiveViewParams> & { credentials?: Credentials };
};
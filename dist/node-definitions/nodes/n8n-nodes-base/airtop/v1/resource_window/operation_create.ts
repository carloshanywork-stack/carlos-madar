/**
 * Airtop Node - Version 1
 * Discriminator: resource=window, operation=create
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Create an Airtop browser session */
export type AirtopV1WindowCreateParams = {
  resource: 'window';
  operation: 'create';
/**
 * The ID of the &lt;a href="https://docs.airtop.ai/guides/how-to/creating-a-session" target="_blank"&gt;Session&lt;/a&gt; to use
 * @default ={{ $json["sessionId"] }}
 */
    sessionId?: string | Expression<string>;
/**
 * Initial URL to load in the window. Defaults to https://www.google.com.
 */
    url?: string | Expression<string>;
/**
 * Whether to get the URL of the window's &lt;a href="https://docs.airtop.ai/guides/how-to/creating-a-live-view" target="_blank"&gt;Live View&lt;/a&gt;
 * @default false
 */
    getLiveView?: boolean | Expression<boolean>;
/**
 * Whether to include the navigation bar in the Live View. When enabled, the navigation bar will be visible allowing you to navigate between pages.
 * @displayOptions.show { getLiveView: [true] }
 * @default false
 */
    includeNavigationBar?: boolean | Expression<boolean>;
/**
 * The screen resolution of the Live View. Setting a resolution will force the window to open at that specific size.
 * @displayOptions.show { getLiveView: [true] }
 */
    screenResolution?: string | Expression<string>;
/**
 * Whether to disable the window from being resized in the Live View
 * @displayOptions.show { getLiveView: [true] }
 * @default false
 */
    disableResize?: boolean | Expression<boolean>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Wait until the specified loading event occurs
     * @default load
     */
    waitUntil?: 'load' | 'domContentLoaded' | 'complete' | 'noWait' | Expression<string>;
  };
};

export type AirtopV1WindowCreateOutput = {
  data?: {
    liveViewUrl?: string;
    targetId?: string;
    windowId?: string;
  };
  errors?: null;
  meta?: {
    requestId?: string;
  };
  sessionId?: string;
  warnings?: null;
  windowId?: string;
};

export type AirtopV1WindowCreateNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1WindowCreateParams> & { credentials?: Credentials };
  output?: Items<AirtopV1WindowCreateOutput>;
};
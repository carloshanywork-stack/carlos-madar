/**
 * Airtop Node - Version 1.1
 * Discriminator: resource=interaction, operation=scroll
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Execute a scroll action on the page */
export type AirtopV11InteractionScrollParams = {
  resource: 'interaction';
  operation: 'scroll';
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
 * Choose the mode of scrolling
 * @default automatic
 */
    scrollingMode?: 'automatic' | 'manual' | Expression<string>;
/**
 * A natural language description of the element to scroll to
 * @displayOptions.show { scrollingMode: ["automatic"] }
 * @required when the displayOptions conditions above match
 */
    scrollToElement?: string | Expression<string>;
/**
 * The direction to scroll to. When 'Scroll By' is defined, 'Scroll To Edge' action will be executed first, then 'Scroll By' action.
 * @displayOptions.show { scrollingMode: ["manual"] }
 * @default {}
 */
    scrollToEdge?: {
        /** Page Edges
     */
    edgeValues?: {
      /** Vertically
       */
      yAxis?: '' | 'top' | 'bottom' | Expression<string>;
      /** Horizontally
       */
      xAxis?: '' | 'left' | 'right' | Expression<string>;
    };
  };
/**
 * The amount to scroll by. When 'Scroll To Edge' is defined, 'Scroll By' action will be executed after 'Scroll To Edge'.
 * @displayOptions.show { scrollingMode: ["manual"] }
 * @default {}
 */
    scrollBy?: {
        /** The amount in pixels or percentage to scroll by
     */
    scrollValues?: {
      /** Vertically
       */
      yAxis?: string | Expression<string>;
      /** Horizontally
       */
      xAxis?: string | Expression<string>;
    };
  };
/**
 * Scroll within an element on the page
 */
    scrollWithin?: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Defines the strategy for visual analysis of the current window
     * @default auto
     */
    visualScope?: 'auto' | 'viewport' | 'page' | 'scan' | Expression<string>;
    /** The condition to wait for the navigation to complete after an interaction (click, type or hover). Defaults to 'Fully Loaded'.
     * @default load
     */
    waitForNavigation?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' | Expression<string>;
  };
};

export type AirtopV11InteractionScrollNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1.1;
  config: NodeConfig<AirtopV11InteractionScrollParams> & { credentials?: Credentials };
};
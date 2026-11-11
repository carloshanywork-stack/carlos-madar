/**
 * Airtop Node - Version 1
 * Discriminator: resource=interaction, operation=click
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Execute a click on an element given a description */
export type AirtopV1InteractionClickParams = {
  resource: 'interaction';
  operation: 'click';
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
 * A specific description of the element to execute the interaction on
 */
    elementDescription: string | Expression<string>;
/**
 * The type of click to perform. Defaults to left click.
 * @default click
 */
    clickType?: 'click' | 'doubleClick' | 'rightClick' | Expression<string>;
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

export type AirtopV1InteractionClickOutput = {
  data?: {
    modelResponse?: string;
  };
  meta?: {
    actionId?: string;
    requestId?: string;
    status?: string;
    usage?: {
      credits?: number;
      id?: string;
    };
  };
  sessionId?: string;
  warnings?: Array<{
    message?: string;
  }>;
  windowId?: string;
};

export type AirtopV1InteractionClickNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1InteractionClickParams> & { credentials?: Credentials };
  output?: Items<AirtopV1InteractionClickOutput>;
};
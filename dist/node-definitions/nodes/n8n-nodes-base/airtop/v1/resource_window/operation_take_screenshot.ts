/**
 * Airtop Node - Version 1
 * Discriminator: resource=window, operation=takeScreenshot
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Take a screenshot of the current window */
export type AirtopV1WindowTakeScreenshotParams = {
  resource: 'window';
  operation: 'takeScreenshot';
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
 * Whether to output the image as a binary file instead of a base64 encoded string
 * @default false
 */
    outputImageAsBinary?: boolean | Expression<boolean>;
};

export type AirtopV1WindowTakeScreenshotNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1WindowTakeScreenshotParams> & { credentials?: Credentials };
};
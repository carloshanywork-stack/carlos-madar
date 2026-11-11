/**
 * Airtop Node - Version 1
 * Discriminator: resource=interaction, operation=fill
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Fill a form with the provided information */
export type AirtopV1InteractionFillParams = {
  resource: 'interaction';
  operation: 'fill';
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
 * The information to fill into the form written in natural language
 */
    formData: string | Expression<string>;
};

export type AirtopV1InteractionFillNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1InteractionFillParams> & { credentials?: Credentials };
};
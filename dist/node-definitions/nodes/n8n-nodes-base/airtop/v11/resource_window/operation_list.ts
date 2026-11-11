/**
 * Airtop Node - Version 1.1
 * Discriminator: resource=window, operation=list
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** List all browser windows in a session */
export type AirtopV11WindowListParams = {
  resource: 'window';
  operation: 'list';
/**
 * The ID of the &lt;a href="https://docs.airtop.ai/guides/how-to/creating-a-session" target="_blank"&gt;Session&lt;/a&gt; to use
 * @default ={{ $json["sessionId"] }}
 */
    sessionId?: string | Expression<string>;
};

export type AirtopV11WindowListNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1.1;
  config: NodeConfig<AirtopV11WindowListParams> & { credentials?: Credentials };
};
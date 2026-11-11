/**
 * Airtop Node - Version 1
 * Discriminator: resource=session, operation=waitForDownload
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Wait for a file download to become available */
export type AirtopV1SessionWaitForDownloadParams = {
  resource: 'session';
  operation: 'waitForDownload';
/**
 * The ID of the &lt;a href="https://docs.airtop.ai/guides/how-to/creating-a-session" target="_blank"&gt;Session&lt;/a&gt; to use
 * @default ={{ $json["sessionId"] }}
 */
    sessionId?: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Time in seconds to wait for the download to become available
     * @default 30
     */
    timeout?: number | Expression<number>;
  };
};

export type AirtopV1SessionWaitForDownloadNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1SessionWaitForDownloadParams> & { credentials?: Credentials };
};
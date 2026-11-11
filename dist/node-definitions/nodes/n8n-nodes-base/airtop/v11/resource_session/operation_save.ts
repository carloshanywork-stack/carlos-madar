/**
 * Airtop Node - Version 1.1
 * Discriminator: resource=session, operation=save
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Save in a profile changes made in your browsing session such as cookies and local storage */
export type AirtopV11SessionSaveParams = {
  resource: 'session';
  operation: 'save';
/**
 * The ID of the &lt;a href="https://docs.airtop.ai/guides/how-to/creating-a-session" target="_blank"&gt;Session&lt;/a&gt; to use
 * @default ={{ $json["sessionId"] }}
 */
    sessionId?: string | Expression<string>;
/**
 * The ID to save this session's &lt;a href="https://docs.airtop.ai/guides/how-to/saving-a-profile" target="_blank"&gt;Browser Profile&lt;/a&gt; under. A profile with this ID is created if it does not exist yet.
 * @hint Must consist only of alphanumeric characters and hyphens "-"
 */
    profileName: string | Expression<string>;
};

export type AirtopV11SessionSaveNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1.1;
  config: NodeConfig<AirtopV11SessionSaveParams> & { credentials?: Credentials };
};
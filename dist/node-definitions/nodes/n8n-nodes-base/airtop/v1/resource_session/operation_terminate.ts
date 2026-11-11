/**
 * Airtop Node - Version 1
 * Discriminator: resource=session, operation=terminate
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Terminate a session */
export type AirtopV1SessionTerminateParams = {
  resource: 'session';
  operation: 'terminate';
/**
 * The ID of the &lt;a href="https://docs.airtop.ai/guides/how-to/creating-a-session" target="_blank"&gt;Session&lt;/a&gt; to use
 * @default ={{ $json["sessionId"] }}
 */
    sessionId?: string | Expression<string>;
};

export type AirtopV1SessionTerminateOutput = {
  success?: boolean;
};

export type AirtopV1SessionTerminateNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1SessionTerminateParams> & { credentials?: Credentials };
  output?: Items<AirtopV1SessionTerminateOutput>;
};
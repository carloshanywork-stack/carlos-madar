/**
 * Airtop Node - Version 1.1
 * Discriminator: resource=file, operation=load
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Load a URL in an existing window */
export type AirtopV11FileLoadParams = {
  resource: 'file';
  operation: 'load';
/**
 * The session ID to load the file into
 * @default ={{ $json["sessionId"] }}
 */
    sessionId?: string | Expression<string>;
/**
 * The window ID to trigger the file input in
 * @default ={{ $json["windowId"] }}
 */
    windowId?: string | Expression<string>;
/**
 * ID of the file to load into the session
 */
    fileId: string | Expression<string>;
/**
 * Optional description of the file input to interact with
 */
    elementDescription?: string | Expression<string>;
/**
 * Whether to include hidden elements in the interaction
 * @default true
 */
    includeHiddenElements?: boolean | Expression<boolean>;
};

export type AirtopV11FileLoadNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1.1;
  config: NodeConfig<AirtopV11FileLoadParams> & { credentials?: Credentials };
};
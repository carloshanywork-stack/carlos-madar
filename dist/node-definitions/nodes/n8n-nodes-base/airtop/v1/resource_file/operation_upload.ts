/**
 * Airtop Node - Version 1
 * Discriminator: resource=file, operation=upload
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Upload a file into a session */
export type AirtopV1FileUploadParams = {
  resource: 'file';
  operation: 'upload';
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
 * Name for the file to upload. For a session, all files loaded should have &lt;b&gt;unique names&lt;/b&gt;.
 */
    fileName: string | Expression<string>;
/**
 * Choose the type of file to upload. Defaults to 'Customer Upload'.
 * @default customer_upload
 */
    fileType?: 'browser_download' | 'screenshot' | 'video' | 'customer_upload' | Expression<string>;
/**
 * Source of the file to upload
 * @default url
 */
    source?: 'url' | 'binary' | Expression<string>;
/**
 * Name of the binary property containing the file data
 * @displayOptions.show { source: ["binary"] }
 * @default data
 */
    binaryPropertyName?: string | Expression<string>;
/**
 * URL from where to fetch the file to upload
 * @displayOptions.show { source: ["url"] }
 * @required when the displayOptions conditions above match
 */
    url?: string | Expression<string>;
/**
 * Whether to automatically trigger the file input dialog in the current window. If disabled, the file will only be uploaded to the session without opening the file input dialog.
 * @default true
 */
    triggerFileInputParameter?: boolean | Expression<boolean>;
/**
 * Optional description of the file input to interact with
 * @displayOptions.show { triggerFileInputParameter: [true] }
 */
    elementDescription?: string | Expression<string>;
/**
 * Whether to include hidden elements in the interaction
 * @displayOptions.show { triggerFileInputParameter: [true] }
 * @default true
 */
    includeHiddenElements?: boolean | Expression<boolean>;
};

export type AirtopV1FileUploadNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1FileUploadParams> & { credentials?: Credentials };
};
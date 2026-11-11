/**
 * Airtop Node - Version 1
 * Discriminator: resource=extraction, operation=query
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Query a page to extract data or ask a question given the data on the page */
export type AirtopV1ExtractionQueryParams = {
  resource: 'extraction';
  operation: 'query';
/**
 * Choose between creating a new session or using an existing one
 * @default existing
 */
    sessionMode?: 'new' | 'existing' | Expression<string>;
/**
 * The ID of the &lt;a href="https://docs.airtop.ai/guides/how-to/creating-a-session" target="_blank"&gt;Session&lt;/a&gt; to use
 * @displayOptions.show { sessionMode: ["existing"] }
 * @default ={{ $json["sessionId"] }}
 */
    sessionId?: string | Expression<string>;
/**
 * The ID of the &lt;a href="https://docs.airtop.ai/guides/how-to/creating-a-session#windows" target="_blank"&gt;Window&lt;/a&gt; to use
 * @displayOptions.show { sessionMode: ["existing"] }
 * @default ={{ $json["windowId"] }}
 */
    windowId?: string | Expression<string>;
/**
 * URL to load in the window
 * @displayOptions.show { sessionMode: ["new"] }
 * @required when the displayOptions conditions above match
 */
    url?: string | Expression<string>;
/**
 * The Airtop browser profile ID to load or create. Newer profiles are identified by a generated UUID; older ones can use a custom name.
 * @hint &lt;a href="https://docs.airtop.ai/guides/how-to/saving-a-profile" target="_blank"&gt;Learn more&lt;/a&gt; about Airtop profiles
 * @displayOptions.show { sessionMode: ["new"] }
 */
    profileName?: string | Expression<string>;
/**
 * Whether to terminate the session after the operation is complete. When disabled, you must manually terminate the session. By default, idle sessions timeout after 10 minutes
 * @displayOptions.show { sessionMode: ["new"] }
 * @default true
 */
    autoTerminateSession?: boolean | Expression<boolean>;
/**
 * The prompt to query the page content
 */
    prompt: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** JSON schema defining the structure of the output
     * @hint If you want to force your output to be JSON, provide a valid JSON schema describing the output. You can generate one automatically in the &lt;a href="https://portal.airtop.ai/" target="_blank"&gt;Airtop API Playground&lt;/a&gt;.
     */
    outputSchema?: IDataObject | string | Expression<string>;
    /** Whether to parse the model's response to JSON in the output. Requires the 'JSON Output Schema' parameter to be set.
     * @default true
     */
    parseJsonOutput?: boolean | Expression<boolean>;
    /** Whether to analyze the web page visually when fulfilling the request
     * @default false
     */
    includeVisualAnalysis?: boolean | Expression<boolean>;
  };
};

export type AirtopV1ExtractionQueryOutput = {
  data?: {
    modelResponse?: string;
  };
  meta?: {
    requestId?: string;
    status?: string;
    usage?: {
      credits?: number;
      id?: string;
    };
  };
  warnings?: Array<{
    message?: string;
  }>;
};

export type AirtopV1ExtractionQueryNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1ExtractionQueryParams> & { credentials?: Credentials };
  output?: Items<AirtopV1ExtractionQueryOutput>;
};
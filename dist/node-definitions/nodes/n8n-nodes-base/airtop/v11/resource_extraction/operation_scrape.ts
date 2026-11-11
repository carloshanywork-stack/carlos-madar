/**
 * Airtop Node - Version 1.1
 * Discriminator: resource=extraction, operation=scrape
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Scrape a page and return the data as markdown */
export type AirtopV11ExtractionScrapeParams = {
  resource: 'extraction';
  operation: 'scrape';
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
};

export type AirtopV11ExtractionScrapeOutput = {
  data?: {
    modelResponse?: {
      scrapedContent?: {
        contentType?: string;
        text?: string;
      };
      title?: string;
    };
  };
  meta?: {
    requestId?: string;
    status?: string;
    usage?: {
      credits?: number;
      id?: string;
    };
  };
  sessionId?: string;
  windowId?: string;
};

export type AirtopV11ExtractionScrapeNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1.1;
  config: NodeConfig<AirtopV11ExtractionScrapeParams> & { credentials?: Credentials };
  output?: Items<AirtopV11ExtractionScrapeOutput>;
};
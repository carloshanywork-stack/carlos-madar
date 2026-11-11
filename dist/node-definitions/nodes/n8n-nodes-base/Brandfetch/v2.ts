/**
 * Brandfetch Node - Version 2
 * Consume Brandfetch API
 */


export interface BrandfetchV2Params {
  operation?: 'logo' | 'colors' | 'data' | 'context';
/**
 * The type of identifier used to look up the brand
 * @displayOptions.show { operation: ["logo", "colors", "data"] }
 * @default domain
 */
    type?: 'domain' | 'ticker' | 'crypto' | 'isin' | Expression<string>;
/**
 * The identifier of the brand. Format depends on the selected Type (e.g. apple.com, AAPL, BTC, US0378331005).
 * @displayOptions.show { operation: ["colors", "data", "logo"] }
 * @required when the displayOptions conditions above match
 */
    identifier?: string | Expression<string>;
/**
 * The domain name of the brand to get context for
 * @displayOptions.show { operation: ["context"] }
 * @required when the displayOptions conditions above match
 */
    domain?: string | Expression<string>;
/**
 * The format the brand context is returned in
 * @displayOptions.show { operation: ["context"] }
 * @default json
 */
    outputFormat?: 'json' | 'markdown' | Expression<string>;
/**
 * Whether to return the brand context only if one is already cached, responding instantly without crawling the domain. Returns an empty item if no cached context exists.
 * @displayOptions.show { operation: ["context"] }
 * @default false
 */
    cachedOnly?: boolean | Expression<boolean>;
/**
 * Whether to download all logo files as binary data
 * @displayOptions.show { operation: ["logo"] }
 * @default false
 */
    download?: boolean | Expression<boolean>;
}

export interface BrandfetchV2Credentials {
  brandfetchApi: CredentialReference;
}

interface BrandfetchV2NodeBase {
  type: 'n8n-nodes-base.Brandfetch';
  version: 2;
}

export type BrandfetchV2ParamsNode = BrandfetchV2NodeBase & {
  config: NodeConfig<BrandfetchV2Params> & { credentials?: BrandfetchV2Credentials };
};

export type BrandfetchV2Node = BrandfetchV2ParamsNode;
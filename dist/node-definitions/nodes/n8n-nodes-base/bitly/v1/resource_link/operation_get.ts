/**
 * Bitly Node - Version 1
 * Discriminator: resource=link, operation=get
 */


interface Credentials {
  bitlyApi: CredentialReference;
  bitlyOAuth2Api: CredentialReference;
}

/** Get a link */
export type BitlyV1LinkGetParams = {
  resource: 'link';
  operation: 'get';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Bitlink
 */
    id: string | Expression<string>;
};

export type BitlyV1LinkGetNode = {
  type: 'n8n-nodes-base.bitly';
  version: 1;
  config: NodeConfig<BitlyV1LinkGetParams> & { credentials?: Credentials };
};
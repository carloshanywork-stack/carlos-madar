/**
 * Cloudflare Node - Version 1
 * Discriminator: resource=zoneCertificate, operation=get
 */


interface Credentials {
  cloudflareApi: CredentialReference;
}

/** Get a certificate */
export type CloudflareV1ZoneCertificateGetParams = {
  resource: 'zoneCertificate';
  operation: 'get';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getZones
 */
    zoneId: string | Expression<string>;
/**
 * Certificate ID
 */
    certificateId: string | Expression<string>;
};

export type CloudflareV1ZoneCertificateGetNode = {
  type: 'n8n-nodes-base.cloudflare';
  version: 1;
  config: NodeConfig<CloudflareV1ZoneCertificateGetParams> & { credentials?: Credentials };
};
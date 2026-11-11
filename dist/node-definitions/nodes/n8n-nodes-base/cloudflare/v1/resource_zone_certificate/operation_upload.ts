/**
 * Cloudflare Node - Version 1
 * Discriminator: resource=zoneCertificate, operation=upload
 */


interface Credentials {
  cloudflareApi: CredentialReference;
}

/** Upload a certificate */
export type CloudflareV1ZoneCertificateUploadParams = {
  resource: 'zoneCertificate';
  operation: 'upload';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getZones
 */
    zoneId: string | Expression<string>;
/**
 * The zone's leaf certificate
 */
    certificate: string | Expression<string>;
/**
 * Private Key
 */
    privateKey: string | Expression<string>;
};

export type CloudflareV1ZoneCertificateUploadNode = {
  type: 'n8n-nodes-base.cloudflare';
  version: 1;
  config: NodeConfig<CloudflareV1ZoneCertificateUploadParams> & { credentials?: Credentials };
};
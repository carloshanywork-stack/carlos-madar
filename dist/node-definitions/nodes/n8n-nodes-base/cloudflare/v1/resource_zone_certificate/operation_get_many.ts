/**
 * Cloudflare Node - Version 1
 * Discriminator: resource=zoneCertificate, operation=getMany
 */


interface Credentials {
  cloudflareApi: CredentialReference;
}

/** Get many certificates */
export type CloudflareV1ZoneCertificateGetManyParams = {
  resource: 'zoneCertificate';
  operation: 'getMany';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getZones
 */
    zoneId: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 25
 */
    limit?: number | Expression<number>;
/**
 * Filters
 * @default {}
 */
    filters?: {
    /** Status of the zone's custom SSL
     */
    status?: 'active' | 'expired' | 'deleted' | 'pending' | Expression<string>;
  };
};

export type CloudflareV1ZoneCertificateGetManyNode = {
  type: 'n8n-nodes-base.cloudflare';
  version: 1;
  config: NodeConfig<CloudflareV1ZoneCertificateGetManyParams> & { credentials?: Credentials };
};
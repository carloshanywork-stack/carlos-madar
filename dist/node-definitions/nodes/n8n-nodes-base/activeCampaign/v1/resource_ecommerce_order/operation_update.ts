/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=ecommerceOrder, operation=update
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Update an account */
export type ActiveCampaignV1EcommerceOrderUpdateParams = {
  resource: 'ecommerceOrder';
  operation: 'update';
/**
 * The ID of the e-commerce order
 * @default 0
 */
    orderId?: number | Expression<number>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** The ID of the order in the external service. ONLY REQUIRED IF EXTERNALCHECKOUTID NOT INCLUDED.
     */
    externalid?: string | Expression<string>;
    /** The ID of the cart in the external service. ONLY REQUIRED IF EXTERNALID IS NOT INCLUDED.
     */
    externalcheckoutid?: string | Expression<string>;
    /** The order source code (0 - will not trigger automations, 1 - will trigger automations)
     * @default 0
     */
    source?: number | Expression<number>;
    /** The email address of the customer who placed the order
     */
    email?: string | Expression<string>;
    /** The total price of the order in cents, including tax and shipping charges. (i.e. $456.78 =&gt; 45678). Must be greater than or equal to zero.
     * @default 0
     */
    totalPrice?: number | Expression<number>;
    /** The currency of the order (3-digit ISO code, e.g., "USD")
     * @default eur
     */
    currency?: 'eur' | 'usd' | 'gbp' | 'chf' | 'cny' | '' | 'aed' | 'afn' | 'all' | 'amd' | 'ang' | 'aoa' | 'ars' | 'aud' | 'awg' | 'azn' | 'bam' | 'bbd' | 'bdt' | 'bgn' | 'bhd' | 'bif' | 'bmd' | 'bnd' | 'bob' | 'brl' | 'bsd' | 'btc' | 'btn' | 'bwp' | 'byn' | 'bzd' | 'cad' | 'cdf' | 'clf' | 'clp' | 'cnh' | 'cop' | 'crc' | 'cuc' | 'cup' | 'cve' | 'czk' | 'djf' | 'dkk' | 'dop' | 'dzd' | 'egp' | 'ern' | 'etb' | 'fjd' | 'fkp' | 'gel' | 'ggp' | 'ghs' | 'gip' | 'gmd' | 'gnf' | 'gtq' | 'gyd' | 'hkd' | 'hnl' | 'hrk' | 'htg' | 'huf' | 'idr' | 'ils' | 'imp' | 'inr' | 'iqd' | 'irr' | 'isk' | 'jep' | 'jmd' | 'jod' | 'jpy' | 'kes' | 'kgs' | 'khr' | 'kmf' | 'kpw' | 'krw' | 'kwd' | 'kyd' | 'kzt' | 'lak' | 'lbp' | 'lkr' | 'lrd' | 'lsl' | 'lyd' | 'mad' | 'mdl' | 'mga' | 'mkd' | 'mmk' | 'mnt' | 'mop' | 'mro' | 'mru' | 'mur' | 'mvr' | 'mwk' | 'mxn' | 'myr' | 'mzn' | 'nad' | 'ngn' | 'nio' | 'nok' | 'npr' | 'nzd' | 'omr' | 'pab' | 'pen' | 'pgk' | 'php' | 'pkr' | 'pln' | 'pyg' | 'qar' | 'ron' | 'rsd' | 'rub' | 'rwf' | 'sar' | 'sbd' | 'scr' | 'sdg' | 'sek' | 'sgd' | 'shp' | 'sll' | 'sos' | 'srd' | 'ssp' | 'std' | 'stn' | 'svc' | 'syp' | 'szl' | 'thb' | 'tjs' | 'tmt' | 'tnd' | 'top' | 'try' | 'ttd' | 'twd' | 'tzs' | 'uah' | 'ugx' | 'uyu' | 'uzs' | 'vef' | 'vnd' | 'vuv' | 'wst' | 'xaf' | 'xag' | 'xau' | 'xcd' | 'xdr' | 'xof' | 'xpd' | 'xpf' | 'xpt' | 'yer' | 'zar' | 'zmw' | 'zwl' | Expression<string>;
    /** The ID of the connection from which this order originated
     * @default 0
     */
    connectionid?: number | Expression<number>;
    /** The ID of the customer associated with this order
     * @default 0
     */
    customerid?: number | Expression<number>;
    /** The date the order was placed
     */
    externalupdatedDate?: string | Expression<string>;
    /** The date the cart was abandoned. REQUIRED ONLY IF INCLUDING EXTERNALCHECKOUTID.
     */
    abandonedDate?: string | Expression<string>;
    /** The total shipping amount for the order in cents
     * @default 0
     */
    shippingAmount?: number | Expression<number>;
    /** The total tax amount for the order in cents
     * @default 0
     */
    taxAmount?: number | Expression<number>;
    /** The total discount amount for the order in cents
     * @default 0
     */
    discountAmount?: number | Expression<number>;
    /** The URL for the order in the external service
     */
    orderUrl?: string | Expression<string>;
    /** The date the order was updated
     */
    externalUpdatedDate?: string | Expression<string>;
    /** The shipping method of the order
     */
    shippingMethod?: string | Expression<string>;
    /** The order number. This can be different than the externalid.
     */
    orderNumber?: string | Expression<string>;
    /** All ordered products
     * @default {}
     */
    orderProducts?: Array<{
    /** The name of the product
     */
    name?: string | Expression<string>;
    /** The price of the product, in cents. (i.e. $456.78 =&gt; 45678). Must be greater than or equal to zero.
     * @default 0
     */
    price?: number | Expression<number>;
    /** The quantity ordered
     * @default 0
     */
    quantity?: number | Expression<number>;
    /** The ID of the product in the external service
     */
    externalid?: string | Expression<string>;
    /** The category of the product
     */
    category?: string | Expression<string>;
    /** The SKU for the product
     */
    sku?: string | Expression<string>;
    /** The description of the product
     */
    description?: string | Expression<string>;
    /** An Image URL that displays an image of the product
     */
    imageUrl?: string | Expression<string>;
    /** A URL linking to the product in your store
     */
    productUrl?: string | Expression<string>;
  }>;
  };
};

export type ActiveCampaignV1EcommerceOrderUpdateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1EcommerceOrderUpdateParams> & { credentials?: Credentials };
};
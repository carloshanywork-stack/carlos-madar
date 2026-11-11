/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=deal, operation=update
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Update an account */
export type ActiveCampaignV1DealUpdateParams = {
  resource: 'deal';
  operation: 'update';
/**
 * ID of the deal to update
 * @default 0
 */
    dealId?: number | Expression<number>;
/**
 * The fields to update
 * @default {}
 */
    updateFields?: {
    /** The title of the deal
     */
    title?: string | Expression<string>;
    /** The ID of the deal's contact
     * @default 0
     */
    contact?: number | Expression<number>;
    /** The value of the deal in cents
     * @default 0
     */
    value?: number | Expression<number>;
    /** The currency of the deal in 3-character ISO format
     * @default eur
     */
    currency?: 'eur' | 'usd' | 'gbp' | 'chf' | 'cny' | '' | 'aed' | 'afn' | 'all' | 'amd' | 'ang' | 'aoa' | 'ars' | 'aud' | 'awg' | 'azn' | 'bam' | 'bbd' | 'bdt' | 'bgn' | 'bhd' | 'bif' | 'bmd' | 'bnd' | 'bob' | 'brl' | 'bsd' | 'btc' | 'btn' | 'bwp' | 'byn' | 'bzd' | 'cad' | 'cdf' | 'clf' | 'clp' | 'cnh' | 'cop' | 'crc' | 'cuc' | 'cup' | 'cve' | 'czk' | 'djf' | 'dkk' | 'dop' | 'dzd' | 'egp' | 'ern' | 'etb' | 'fjd' | 'fkp' | 'gel' | 'ggp' | 'ghs' | 'gip' | 'gmd' | 'gnf' | 'gtq' | 'gyd' | 'hkd' | 'hnl' | 'hrk' | 'htg' | 'huf' | 'idr' | 'ils' | 'imp' | 'inr' | 'iqd' | 'irr' | 'isk' | 'jep' | 'jmd' | 'jod' | 'jpy' | 'kes' | 'kgs' | 'khr' | 'kmf' | 'kpw' | 'krw' | 'kwd' | 'kyd' | 'kzt' | 'lak' | 'lbp' | 'lkr' | 'lrd' | 'lsl' | 'lyd' | 'mad' | 'mdl' | 'mga' | 'mkd' | 'mmk' | 'mnt' | 'mop' | 'mro' | 'mru' | 'mur' | 'mvr' | 'mwk' | 'mxn' | 'myr' | 'mzn' | 'nad' | 'ngn' | 'nio' | 'nok' | 'npr' | 'nzd' | 'omr' | 'pab' | 'pen' | 'pgk' | 'php' | 'pkr' | 'pln' | 'pyg' | 'qar' | 'ron' | 'rsd' | 'rub' | 'rwf' | 'sar' | 'sbd' | 'scr' | 'sdg' | 'sek' | 'sgd' | 'shp' | 'sll' | 'sos' | 'srd' | 'ssp' | 'std' | 'stn' | 'svc' | 'syp' | 'szl' | 'thb' | 'tjs' | 'tmt' | 'tnd' | 'top' | 'try' | 'ttd' | 'twd' | 'tzs' | 'uah' | 'ugx' | 'uyu' | 'uzs' | 'vef' | 'vnd' | 'vuv' | 'wst' | 'xaf' | 'xag' | 'xau' | 'xcd' | 'xdr' | 'xof' | 'xpd' | 'xpf' | 'xpt' | 'yer' | 'zar' | 'zmw' | 'zwl' | Expression<string>;
    /** The description of the deal
     */
    description?: string | Expression<string>;
    /** The pipeline ID of the deal
     */
    group?: string | Expression<string>;
    /** The stage ID of the deal
     */
    stage?: string | Expression<string>;
    /** The owner ID of the deal
     */
    owner?: string | Expression<string>;
    /** The percentage of the deal
     * @default 0
     */
    percent?: number | Expression<number>;
    /** The status of the deal
     * @default 0
     */
    status?: number | Expression<number>;
  };
};

export type ActiveCampaignV1DealUpdateOutput = {
  deal?: {
    activitycount?: string;
    cdate?: string;
    contact?: string;
    currency?: string;
    description?: string;
    group?: string;
    hash?: string;
    id?: string;
    isDisabled?: boolean;
    links?: {
      account?: string;
      contact?: string;
      contactDeals?: string;
      customerAccount?: string;
      dealActivities?: string;
      dealCustomFieldData?: string;
      group?: string;
      nextTask?: string;
      notes?: string;
      organization?: string;
      owner?: string;
      scoreValues?: string;
      stage?: string;
      tasks?: string;
    };
    mdate?: string;
    nextdealid?: string;
    owner?: string;
    percent?: string;
    stage?: string;
    title?: string;
  };
  dealStages?: Array<{
    cardRegion1?: string;
    cardRegion2?: string;
    cardRegion3?: string;
    cardRegion4?: string;
    cardRegion5?: string;
    color?: string;
    dealOrder?: string;
    group?: string;
    id?: string;
    links?: {
      group?: string;
    };
    order?: string;
    title?: string;
    udate?: string;
    width?: string;
  }>;
};

export type ActiveCampaignV1DealUpdateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1DealUpdateParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1DealUpdateOutput>;
};
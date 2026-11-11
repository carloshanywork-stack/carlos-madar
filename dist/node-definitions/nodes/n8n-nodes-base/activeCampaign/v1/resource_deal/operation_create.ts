/**
 * ActiveCampaign Node - Version 1
 * Discriminator: resource=deal, operation=create
 */


interface Credentials {
  activeCampaignApi: CredentialReference;
}

/** Create an account */
export type ActiveCampaignV1DealCreateParams = {
  resource: 'deal';
  operation: 'create';
/**
 * The title of the deal
 */
    title: string | Expression<string>;
/**
 * The ID of the deal's contact
 * @default 0
 */
    contact?: number | Expression<number>;
/**
 * The value of the deal in cents
 * @default 0
 */
    value?: number | Expression<number>;
/**
 * The currency of the deal in 3-character ISO format
 * @default eur
 */
    currency?: 'eur' | 'usd' | 'gbp' | 'chf' | 'cny' | '' | 'aed' | 'afn' | 'all' | 'amd' | 'ang' | 'aoa' | 'ars' | 'aud' | 'awg' | 'azn' | 'bam' | 'bbd' | 'bdt' | 'bgn' | 'bhd' | 'bif' | 'bmd' | 'bnd' | 'bob' | 'brl' | 'bsd' | 'btc' | 'btn' | 'bwp' | 'byn' | 'bzd' | 'cad' | 'cdf' | 'clf' | 'clp' | 'cnh' | 'cop' | 'crc' | 'cuc' | 'cup' | 'cve' | 'czk' | 'djf' | 'dkk' | 'dop' | 'dzd' | 'egp' | 'ern' | 'etb' | 'fjd' | 'fkp' | 'gel' | 'ggp' | 'ghs' | 'gip' | 'gmd' | 'gnf' | 'gtq' | 'gyd' | 'hkd' | 'hnl' | 'hrk' | 'htg' | 'huf' | 'idr' | 'ils' | 'imp' | 'inr' | 'iqd' | 'irr' | 'isk' | 'jep' | 'jmd' | 'jod' | 'jpy' | 'kes' | 'kgs' | 'khr' | 'kmf' | 'kpw' | 'krw' | 'kwd' | 'kyd' | 'kzt' | 'lak' | 'lbp' | 'lkr' | 'lrd' | 'lsl' | 'lyd' | 'mad' | 'mdl' | 'mga' | 'mkd' | 'mmk' | 'mnt' | 'mop' | 'mro' | 'mru' | 'mur' | 'mvr' | 'mwk' | 'mxn' | 'myr' | 'mzn' | 'nad' | 'ngn' | 'nio' | 'nok' | 'npr' | 'nzd' | 'omr' | 'pab' | 'pen' | 'pgk' | 'php' | 'pkr' | 'pln' | 'pyg' | 'qar' | 'ron' | 'rsd' | 'rub' | 'rwf' | 'sar' | 'sbd' | 'scr' | 'sdg' | 'sek' | 'sgd' | 'shp' | 'sll' | 'sos' | 'srd' | 'ssp' | 'std' | 'stn' | 'svc' | 'syp' | 'szl' | 'thb' | 'tjs' | 'tmt' | 'tnd' | 'top' | 'try' | 'ttd' | 'twd' | 'tzs' | 'uah' | 'ugx' | 'uyu' | 'uzs' | 'vef' | 'vnd' | 'vuv' | 'wst' | 'xaf' | 'xag' | 'xau' | 'xcd' | 'xdr' | 'xof' | 'xpd' | 'xpf' | 'xpt' | 'yer' | 'zar' | 'zmw' | 'zwl' | Expression<string>;
/**
 * The pipeline ID of the deal
 */
    group?: string | Expression<string>;
/**
 * The stage ID of the deal
 */
    stage?: string | Expression<string>;
/**
 * The owner ID of the deal
 */
    owner?: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** The description of the deal
     */
    description?: string | Expression<string>;
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

export type ActiveCampaignV1DealCreateOutput = {
  contacts?: Array<{
    anonymized?: string;
    bounced_date?: null;
    bounced_hard?: string;
    bounced_soft?: string;
    cdate?: string;
    created_timestamp?: string;
    created_utc_timestamp?: string;
    deleted?: string;
    deleted_at?: null;
    email?: string;
    email_domain?: string;
    email_local?: string;
    firstName?: string;
    gravatar?: string;
    hash?: string;
    id?: string;
    ip?: string;
    last_mpp_open_date?: null;
    lastName?: string;
    links?: {
      accountContacts?: string;
      automationEntryCounts?: string;
      bounceLogs?: string;
      contactAutomations?: string;
      contactData?: string;
      contactDeals?: string;
      contactGoals?: string;
      contactLists?: string;
      contactLogs?: string;
      contactTags?: string;
      deals?: string;
      fieldValues?: string;
      geoIps?: string;
      notes?: string;
      organization?: string;
      plusAppend?: string;
      scoreValues?: string;
      trackingLogs?: string;
    };
    mpp_tracking?: string;
    organization?: null;
    orgid?: string;
    orgname?: string;
    phone?: string;
    segmentio_id?: string;
    sentcnt?: string;
    socialdata_lastcheck?: null;
    udate?: string;
    updated_timestamp?: string;
    updated_utc_timestamp?: string;
  }>;
  deal?: {
    account?: null;
    cdate?: string;
    contact?: string;
    currency?: string;
    customerAccount?: null;
    description?: string;
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
    nextdate?: null;
    nextdealid?: string;
    organization?: null;
    status?: number;
    title?: string;
    winProbability?: null;
    winProbabilityMdate?: null;
  };
  dealGroups?: Array<{
    allgroups?: string;
    allusers?: string;
    autoassign?: string;
    cdate?: string;
    currency?: string;
    id?: string;
    links?: {
      dealGroupGroups?: string;
      dealGroupUsers?: string;
      stages?: string;
      winProbabilityFeatures?: string;
    };
    title?: string;
    udate?: string;
    win_probability_initialize_date?: null;
  }>;
  dealStages?: Array<{
    cardRegion1?: string;
    cardRegion2?: string;
    cardRegion3?: string;
    cardRegion4?: string;
    cardRegion5?: string;
    cdate?: null;
    color?: string;
    dealOrder?: string;
    group?: string;
    id?: string;
    links?: {
      group?: string;
    };
    order?: string;
    title?: string;
    width?: string;
  }>;
};

export type ActiveCampaignV1DealCreateNode = {
  type: 'n8n-nodes-base.activeCampaign';
  version: 1;
  config: NodeConfig<ActiveCampaignV1DealCreateParams> & { credentials?: Credentials };
  output?: Items<ActiveCampaignV1DealCreateOutput>;
};
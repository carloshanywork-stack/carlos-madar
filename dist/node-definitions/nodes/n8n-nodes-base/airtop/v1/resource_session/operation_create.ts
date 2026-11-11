/**
 * Airtop Node - Version 1
 * Discriminator: resource=session, operation=create
 */


interface Credentials {
  airtopApi: CredentialReference;
}

/** Create an Airtop browser session */
export type AirtopV1SessionCreateParams = {
  resource: 'session';
  operation: 'create';
/**
 * The Airtop browser profile ID to load or create. Newer profiles are identified by a generated UUID; older ones can use a custom name.
 * @hint &lt;a href="https://docs.airtop.ai/guides/how-to/saving-a-profile" target="_blank"&gt;Learn more&lt;/a&gt; about Airtop profiles
 */
    profileName?: string | Expression<string>;
/**
 * Whether to automatically save the &lt;a href="https://docs.airtop.ai/guides/how-to/saving-a-profile" target="_blank"&gt;Airtop profile&lt;/a&gt; for this session upon termination
 * @default false
 */
    saveProfileOnTermination?: boolean | Expression<boolean>;
/**
 * Whether to record the browser session. &lt;a href="https://docs.airtop.ai/guides/how-to/recording-a-session" target="_blank"&gt;More details&lt;/a&gt;.
 * @default false
 */
    record?: boolean | Expression<boolean>;
/**
 * Minutes to wait before the session is terminated due to inactivity
 * @default 10
 */
    timeoutMinutes?: number | Expression<number>;
/**
 * Choose how to configure the proxy for this session
 * @default none
 */
    proxy?: 'none' | 'integrated' | 'proxyUrl' | Expression<string>;
/**
 * The Airtop-provided configuration to use for the proxy
 * @displayOptions.show { proxy: ["integrated"] }
 * @default {"country":"US","sticky":true}
 */
    proxyConfig?: {
    /** The country to use for the proxy. Not all countries are guaranteed to provide a proxy. Learn more &lt;a href="https://docs.airtop.ai/api-reference/airtop-api/sessions/create#request.body.configuration.proxy.Proxy.Airtop-Proxy-Configuration.country" target="_blank"&gt;here&lt;/a&gt;.
     * @default US
     */
    country?: 'AF' | 'AX' | 'AL' | 'DZ' | 'AS' | 'AD' | 'AO' | 'AI' | 'AQ' | 'AG' | 'AR' | 'AM' | 'AW' | 'AU' | 'AT' | 'AZ' | 'BS' | 'BH' | 'BD' | 'BB' | 'BY' | 'BE' | 'BZ' | 'BJ' | 'BM' | 'BT' | 'BO' | 'BQ' | 'BA' | 'BW' | 'BV' | 'BR' | 'IO' | 'BN' | 'BG' | 'BF' | 'BI' | 'CV' | 'KH' | 'CM' | 'CA' | 'KY' | 'CF' | 'TD' | 'CL' | 'CN' | 'CX' | 'CC' | 'CO' | 'KM' | 'CG' | 'CD' | 'CK' | 'CR' | 'CI' | 'HR' | 'CU' | 'CW' | 'CY' | 'CZ' | 'DK' | 'DJ' | 'DM' | 'DO' | 'EC' | 'EG' | 'SV' | 'GQ' | 'ER' | 'EE' | 'SZ' | 'ET' | 'FK' | 'FO' | 'FJ' | 'FI' | 'FR' | 'GF' | 'PF' | 'TF' | 'GA' | 'GM' | 'GE' | 'DE' | 'GH' | 'GI' | 'GR' | 'GL' | 'GD' | 'GP' | 'GU' | 'GT' | 'GG' | 'GN' | 'GW' | 'GY' | 'HT' | 'HM' | 'VA' | 'HN' | 'HK' | 'HU' | 'IS' | 'IN' | 'ID' | 'IR' | 'IQ' | 'IE' | 'IM' | 'IL' | 'IT' | 'JM' | 'JP' | 'JE' | 'JO' | 'KZ' | 'KE' | 'KI' | 'KP' | 'KR' | 'KW' | 'KG' | 'LA' | 'LV' | 'LB' | 'LS' | 'LR' | 'LY' | 'LI' | 'LT' | 'LU' | 'MO' | 'MG' | 'MW' | 'MY' | 'MV' | 'ML' | 'MT' | 'MH' | 'MQ' | 'MR' | 'MU' | 'YT' | 'MX' | 'FM' | 'MD' | 'MC' | 'MN' | 'ME' | 'MS' | 'MA' | 'MZ' | 'MM' | 'NA' | 'NR' | 'NP' | 'NL' | 'NC' | 'NZ' | 'NI' | 'NE' | 'NG' | 'NU' | 'NF' | 'MK' | 'MP' | 'NO' | 'OM' | 'PK' | 'PW' | 'PS' | 'PA' | 'PG' | 'PY' | 'PE' | 'PH' | 'PN' | 'PL' | 'PT' | 'PR' | 'QA' | 'RE' | 'RO' | 'RU' | 'RW' | 'BL' | 'SH' | 'KN' | 'LC' | 'MF' | 'PM' | 'VC' | 'WS' | 'SM' | 'ST' | 'SA' | 'SN' | 'RS' | 'SC' | 'SL' | 'SG' | 'SX' | 'SK' | 'SI' | 'SB' | 'SO' | 'ZA' | 'GS' | 'SS' | 'ES' | 'LK' | 'SD' | 'SR' | 'SJ' | 'SE' | 'CH' | 'SY' | 'TW' | 'TJ' | 'TZ' | 'TH' | 'TL' | 'TG' | 'TK' | 'TO' | 'TT' | 'TN' | 'TR' | 'TM' | 'TC' | 'TV' | 'UG' | 'UA' | 'AE' | 'GB' | 'UM' | 'US' | 'UY' | 'UZ' | 'VU' | 'VE' | 'VN' | 'VG' | 'VI' | 'WF' | 'EH' | 'YE' | 'ZM' | 'ZW' | Expression<string>;
    /** Whether to try to maintain the same IP address for the duration of the session. Airtop can guarantee that the same IP address will be available for up to a maximum of 30 minutes.
     * @default true
     */
    sticky?: boolean | Expression<boolean>;
  };
/**
 * The URL of the proxy to use
 * @displayOptions.show { proxy: ["proxyUrl"] }
 */
    proxyUrl?: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Whether to automatically solve &lt;a href="https://docs.airtop.ai/guides/how-to/solving-captchas" target="_blank"&gt;captcha challenges&lt;/a&gt;
     * @default false
     */
    solveCaptcha?: boolean | Expression<boolean>;
    /** Comma-separated extension IDs from the Google Web Store to be loaded into the session. Learn more &lt;a href="https://docs.airtop.ai/guides/how-to/using-chrome-extensions" target="_blank"&gt;here&lt;/a&gt;.
     */
    extensionIds?: string | Expression<string>;
  };
};

export type AirtopV1SessionCreateOutput = {
  data?: {
    cdpUrl?: string;
    cdpWsUrl?: string;
    chromedriverUrl?: string;
    configuration?: {
      baseProfileId?: string;
      timeoutMinutes?: number;
    };
    dateCreated?: string;
    id?: string;
    lastActivity?: string;
    status?: string;
  };
  errors?: null;
  meta?: {
    requestId?: string;
  };
  sessionId?: string;
  warnings?: Array<{
    code?: string;
    message?: string;
  }>;
};

export type AirtopV1SessionCreateNode = {
  type: 'n8n-nodes-base.airtop';
  version: 1;
  config: NodeConfig<AirtopV1SessionCreateParams> & { credentials?: Credentials };
  output?: Items<AirtopV1SessionCreateOutput>;
};
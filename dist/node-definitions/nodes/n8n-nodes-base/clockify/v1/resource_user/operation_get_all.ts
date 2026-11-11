/**
 * Clockify Node - Version 1
 * Discriminator: resource=user, operation=getAll
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Get many clients */
export type ClockifyV1UserGetAllParams = {
  resource: 'user';
  operation: 'getAll';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** If provided, you'll get a filtered list of users that contain the provided string in their email address
     */
    email?: string | Expression<string>;
    /** If provided, you'll get a filtered list of users that contain the provided string in their name
     */
    name?: string | Expression<string>;
    /** If provided, you'll get a filtered list of users with the corresponding status
     */
    status?: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'DECLINED' | Expression<string>;
    /** Sort Column
     */
    'sort-column'?: 'EMAIL' | 'NAME' | 'HOURLYRATE' | Expression<string>;
    /** Sort Order
     */
    'sort-order'?: 'ASCENDING' | 'DESCENDING' | Expression<string>;
  };
};

export type ClockifyV1UserGetAllOutput = {
  activeWorkspace?: string;
  customFields?: Array<{
    customFieldId?: string;
    customFieldName?: string;
    customFieldType?: string;
    userId?: string;
  }>;
  defaultWorkspace?: string;
  email?: string;
  id?: string;
  settings?: {
    alerts?: boolean;
    approval?: boolean;
    collapseAllProjectLists?: boolean;
    dashboardPinToTop?: boolean;
    dashboardSelection?: string;
    dashboardViewType?: string;
    dateFormat?: string;
    groupSimilarEntriesDisabled?: boolean;
    isCompactViewOn?: boolean;
    lang?: string;
    longRunning?: boolean;
    multiFactorEnabled?: boolean;
    myStartOfDay?: string;
    onboarding?: boolean;
    projectPickerTaskFilter?: boolean;
    pto?: boolean;
    reminders?: boolean;
    scheduledReports?: boolean;
    scheduling?: boolean;
    sendNewsletter?: boolean;
    showOnlyWorkingDays?: boolean;
    summaryReportSettings?: {
      group?: string;
      subgroup?: string;
    };
    theme?: string;
    timeFormat?: string;
    timeTrackingManual?: boolean;
    timeZone?: string;
    weeklyUpdates?: boolean;
    weekStart?: string;
  };
  status?: string;
};

export type ClockifyV1UserGetAllNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1UserGetAllParams> & { credentials?: Credentials };
  output?: Items<ClockifyV1UserGetAllOutput>;
};
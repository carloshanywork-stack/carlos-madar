/**
 * Clockify Trigger Node - Version 1
 * Listens to Clockify events
 */


export interface ClockifyTriggerV1Params {
/**
 * Time at which polling should occur
 * @default {"item":[{"mode":"everyMinute"}]}
 */
    pollTimes?: {
        /** Item
     */
    item?: Array<{
      /** How often to trigger.
       * @default everyDay
       */
      mode?: 'everyMinute' | 'everyHour' | 'everyDay' | 'everyWeek' | 'everyMonth' | 'everyX' | 'custom' | Expression<string>;
      /** The hour of the day to trigger (24h format)
       * @displayOptions.hide { mode: ["custom", "everyHour", "everyMinute", "everyX"] }
       * @default 14
       */
      hour?: number | Expression<number>;
      /** The minute past the hour to trigger (0-59)
       * @displayOptions.hide { mode: ["custom", "everyMinute", "everyX"] }
       * @default 0
       */
      minute?: number | Expression<number>;
      /** The day of the month to trigger
       * @displayOptions.show { mode: ["everyMonth"] }
       * @default 1
       */
      dayOfMonth?: number | Expression<number>;
      /** The weekday to trigger
       * @displayOptions.show { mode: ["everyWeek"] }
       * @default 1
       */
      weekday?: '1' | '2' | '3' | '4' | '5' | '6' | '0' | Expression<string>;
      /** Use custom cron expression. Values and ranges as follows:&lt;ul&gt;&lt;li&gt;Seconds: 0-59&lt;/li&gt;&lt;li&gt;Minutes: 0 - 59&lt;/li&gt;&lt;li&gt;Hours: 0 - 23&lt;/li&gt;&lt;li&gt;Day of Month: 1 - 31&lt;/li&gt;&lt;li&gt;Months: 0 - 11 (Jan - Dec)&lt;/li&gt;&lt;li&gt;Day of Week: 0 - 6 (Sun - Sat)&lt;/li&gt;&lt;/ul&gt;
       * @displayOptions.show { mode: ["custom"] }
       * @default * * * * * *
       */
      cronExpression?: string | Expression<string>;
      /** All how many X minutes/hours it should trigger
       * @displayOptions.show { mode: ["everyX"] }
       * @default 2
       */
      value?: number | Expression<number>;
      /** If it should trigger all X minutes or hours
       * @displayOptions.show { mode: ["everyX"] }
       * @default hours
       */
      unit?: 'minutes' | 'hours' | Expression<string>;
    }>;
  };
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 */
    workspaceId: string | Expression<string>;
  watchField?: 0 | Expression<number>;
}

export interface ClockifyTriggerV1Credentials {
  clockifyApi: CredentialReference;
}

interface ClockifyTriggerV1NodeBase {
  type: 'n8n-nodes-base.clockifyTrigger';
  version: 1;
  isTrigger: true;
}

export type ClockifyTriggerV1ParamsNode = ClockifyTriggerV1NodeBase & {
  config: NodeConfig<ClockifyTriggerV1Params> & { credentials?: ClockifyTriggerV1Credentials };
};

export type ClockifyTriggerV1Node = ClockifyTriggerV1ParamsNode;
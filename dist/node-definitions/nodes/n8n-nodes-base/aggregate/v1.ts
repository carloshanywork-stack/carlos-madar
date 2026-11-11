/**
 * Aggregate Node - Version 1
 * Combine a field from many items into a list in a single item
 */


export interface AggregateV1Params {
  aggregate?: 'aggregateIndividualFields' | 'aggregateAllItemData' | Expression<string>;
/**
 * Fields To Aggregate
 * @displayOptions.show { aggregate: ["aggregateIndividualFields"] }
 * @default {"fieldToAggregate":[{"fieldToAggregate":"","renameField":false}]}
 */
    fieldsToAggregate?: {
    fieldToAggregate?: Array<{
      /** The name of a field in the input items to aggregate together
       * @hint  Enter the field name as text
       */
      fieldToAggregate?: string | Expression<string>;
      /** Whether to give the field a different name in the output
       * @default false
       */
      renameField?: boolean | Expression<boolean>;
      /** The name of the field to put the aggregated data in. Leave blank to use the input field name.
       * @displayOptions.show { renameField: [true] }
       */
      outputFieldName?: string | Expression<string>;
    }>;
  };
/**
 * The name of the output field to put the data in
 * @displayOptions.show { aggregate: ["aggregateAllItemData"] }
 * @default data
 */
    destinationFieldName?: string | Expression<string>;
/**
 * Include
 * @displayOptions.show { aggregate: ["aggregateAllItemData"] }
 * @default allFields
 */
    include?: 'allFields' | 'specifiedFields' | 'allFieldsExcept' | Expression<string>;
/**
 * Fields To Exclude
 * @displayOptions.show { aggregate: ["aggregateAllItemData"], include: ["allFieldsExcept"] }
 */
    fieldsToExclude?: string | Expression<string>;
/**
 * Fields To Include
 * @displayOptions.show { aggregate: ["aggregateAllItemData"], include: ["specifiedFields"] }
 */
    fieldsToInclude?: string | Expression<string>;
  options?: {
    /** Whether to disallow referencing child fields using `parent.child` in the field name
     * @displayOptions.hide { /aggregate: ["aggregateAllItemData"] }
     * @default false
     */
    disableDotNotation?: boolean | Expression<boolean>;
    /** Whether to merge the output into a single flat list (rather than a list of lists), if the field to aggregate is a list
     * @displayOptions.hide { /aggregate: ["aggregateAllItemData"] }
     * @default false
     */
    mergeLists?: boolean | Expression<boolean>;
    /** Whether to include the binary data in the new item
     * @default false
     */
    includeBinaries?: boolean | Expression<boolean>;
    /** Whether to keep only unique binaries by comparing mime types, file types, file sizes and file extensions
     * @displayOptions.show { includeBinaries: [true] }
     * @default false
     */
    keepOnlyUnique?: boolean | Expression<boolean>;
    /** Whether to add a null entry to the aggregated list when there is a missing or null value
     * @displayOptions.hide { /aggregate: ["aggregateAllItemData"] }
     * @default false
     */
    keepMissing?: boolean | Expression<boolean>;
  };
}

interface AggregateV1NodeBase {
  type: 'n8n-nodes-base.aggregate';
  version: 1;
}

export type AggregateV1ParamsNode = AggregateV1NodeBase & {
  config: NodeConfig<AggregateV1Params>;
};

export type AggregateV1Node = AggregateV1ParamsNode;
/**
 * AWS Rekognition Node - Version 1
 * Sends data to AWS Rekognition
 */


export interface AwsRekognitionV1Params {
  authentication?: 'iam' | 'assumeRole' | Expression<string>;
  resource?: 'image';
  operation?: 'analyze';
/**
 * Type
 * @displayOptions.show { operation: ["analyze"], resource: ["image"] }
 * @default detectFaces
 */
    type?: 'detectFaces' | 'detectLabels' | 'detectModerationLabels' | 'detectText' | 'recognizeCelebrity' | Expression<string>;
/**
 * Whether the image to analyze should be taken from binary field
 * @displayOptions.show { operation: ["analyze"], resource: ["image"] }
 * @default false
 */
    binaryData?: boolean | Expression<boolean>;
/**
 * Input Binary Field
 * @hint The name of the input binary field containing the file to be written
 * @displayOptions.show { operation: ["analyze"], resource: ["image"], binaryData: [true] }
 * @default data
 */
    binaryPropertyName?: string | Expression<string>;
/**
 * Name of the S3 bucket
 * @displayOptions.show { operation: ["analyze"], resource: ["image"], binaryData: [false] }
 * @required when the displayOptions conditions above match
 */
    bucket?: string | Expression<string>;
/**
 * S3 object key name
 * @displayOptions.show { operation: ["analyze"], resource: ["image"], binaryData: [false] }
 * @required when the displayOptions conditions above match
 */
    name?: string | Expression<string>;
/**
 * Additional Fields
 * @displayOptions.show { operation: ["analyze"], resource: ["image"] }
 * @default {}
 */
    additionalFields?: {
    /** Regions of Interest
     * @displayOptions.show { /type: ["detectText"] }
     * @default {}
     */
    regionsOfInterestUi?: {
        /** Region of Interest
     */
    regionsOfInterestValues?: Array<{
      /** Height of the bounding box as a ratio of the overall image height
       * @default 0
       */
      height?: number | Expression<number>;
      /** Left coordinate of the bounding box as a ratio of overall image width
       * @default 0
       */
      left?: number | Expression<number>;
      /** Top coordinate of the bounding box as a ratio of overall image height
       * @default 0
       */
      top?: number | Expression<number>;
      /** Width of the bounding box as a ratio of the overall image width
       * @default 0
       */
      Width?: number | Expression<number>;
    }>;
  };
    /** If the bucket is versioning enabled, you can specify the object version
     * @displayOptions.show { /binaryData: [false] }
     */
    version?: string | Expression<string>;
    /** Word Filter
     * @displayOptions.show { /type: ["detectText"] }
     * @default {}
     */
    wordFilterUi?: {
    /** Sets the minimum height of the word bounding box. Words with bounding box heights lesser than this value will be excluded from the result. Value is relative to the video frame height.
     * @default 0
     */
    MinBoundingBoxHeight?: number | Expression<number>;
    /** Sets the minimum width of the word bounding box. Words with bounding boxes widths lesser than this value will be excluded from the result. Value is relative to the video frame width.
     * @default 0
     */
    MinBoundingBoxWidth?: number | Expression<number>;
    /** Sets the confidence of word detection. Words with detection confidence below this will be excluded from the result. Values should be between 50 and 100 as Text in Video will not return any result below 50.
     * @default 0
     */
    MinConfidence?: number | Expression<number>;
  };
    /** Maximum number of labels you want the service to return in the response. The service returns the specified number of highest confidence labels.
     * @displayOptions.show { /type: ["detectModerationLabels", "detectLabels"] }
     * @default 0
     */
    maxLabels?: number | Expression<number>;
    /** Specifies the minimum confidence level for the labels to return. Amazon Rekognition doesn't return any labels with a confidence level lower than this specified value.
     * @displayOptions.show { /type: ["detectModerationLabels", "detectLabels"] }
     * @default 0
     */
    minConfidence?: number | Expression<number>;
    /** An array of facial attributes you want to be returned
     * @displayOptions.show { /type: ["detectFaces"] }
     * @default []
     */
    attributes?: Array<'all' | 'default'>;
  };
}

export interface AwsRekognitionV1Credentials {
  aws: CredentialReference;
  awsAssumeRole: CredentialReference;
}

interface AwsRekognitionV1NodeBase {
  type: 'n8n-nodes-base.awsRekognition';
  version: 1;
}

export type AwsRekognitionV1ParamsNode = AwsRekognitionV1NodeBase & {
  config: NodeConfig<AwsRekognitionV1Params> & { credentials?: AwsRekognitionV1Credentials };
};

export type AwsRekognitionV1Node = AwsRekognitionV1ParamsNode;
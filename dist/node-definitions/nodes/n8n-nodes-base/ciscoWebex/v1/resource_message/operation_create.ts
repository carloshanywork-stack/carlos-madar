/**
 * Webex by Cisco Node - Version 1
 * Discriminator: resource=message, operation=create
 */


interface Credentials {
  ciscoWebexOAuth2Api: CredentialReference;
}

export type CiscoWebexV1MessageCreateParams = {
  resource: 'message';
  operation: 'create';
/**
 * Destination
 * @default room
 */
    destination?: 'room' | 'person' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getRooms
 * @displayOptions.show { destination: ["room"] }
 * @required when the displayOptions conditions above match
 */
    roomId?: string | Expression<string>;
/**
 * Specify Person By
 * @displayOptions.show { destination: ["person"] }
 * @default email
 */
    specifyPersonBy?: 'email' | 'id' | Expression<string>;
/**
 * Person ID
 * @displayOptions.show { specifyPersonBy: ["id"] }
 * @required when the displayOptions conditions above match
 */
    toPersonId?: string | Expression<string>;
/**
 * Person Email
 * @displayOptions.show { specifyPersonBy: ["email"] }
 * @required when the displayOptions conditions above match
 */
    toPersonEmail?: string | Expression<string>;
/**
 * The message, in plain text
 */
    text: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Attachments
     * @default {}
     */
    attachmentsUi?: {
        /** Attachment
     */
    attachmentValues?: Array<{
      /** Elements
       * @default {}
       */
      elementsUi?: {
        /** Element
     */
    elementValues?: Array<{
      /** Type
       * @default textBlock
       */
      type?: 'textBlock' | 'inputText' | Expression<string>;
      /** Text to display. A subset of markdown is supported (https://aka.ms/ACTextFeatures).
       * @displayOptions.show { type: ["textBlock"] }
       */
      text?: string | Expression<string>;
      /** Color of the TextBlock element
       * @displayOptions.show { type: ["textBlock"] }
       * @default default
       */
      color?: 'accent' | 'attention' | 'dark' | 'default' | 'good' | 'light' | 'warning' | Expression<string>;
      /** Type of font to use for rendering
       * @displayOptions.show { type: ["textBlock"] }
       * @default default
       */
      fontType?: 'default' | 'monospace' | Expression<string>;
      /** Controls the horizontal text alignment
       * @displayOptions.show { type: ["textBlock"] }
       * @default left
       */
      horizontalAlignment?: 'left' | 'center' | 'right' | Expression<string>;
      /** Whether to display text slightly toned down to appear less prominent
       * @displayOptions.show { type: ["textBlock"] }
       * @default false
       */
      isSubtle?: boolean | Expression<boolean>;
      /** Specifies the maximum number of lines to display
       * @displayOptions.show { type: ["textBlock"] }
       * @default 1
       */
      maxLines?: number | Expression<number>;
      /** Controls size of text
       * @displayOptions.show { type: ["textBlock"] }
       * @default default
       */
      size?: 'default' | 'extraLarge' | 'large' | 'medium' | 'small' | Expression<string>;
      /** Controls the weight of TextBlock elements
       * @displayOptions.show { type: ["textBlock"] }
       * @default default
       */
      weight?: 'default' | 'lighter' | 'bolder' | Expression<string>;
      /** Whether to allow text to wrap. Otherwise, text is clipped.
       * @displayOptions.show { type: ["textBlock"] }
       * @default true
       */
      wrap?: boolean | Expression<boolean>;
      /** Specifies the height of the element
       * @displayOptions.show { type: ["textBlock"] }
       * @default auto
       */
      height?: 'auto' | 'stretch' | Expression<string>;
      /** Whether to draw a separating line at the top of the element
       * @displayOptions.show { type: ["textBlock"] }
       * @default false
       */
      separator?: boolean | Expression<boolean>;
      /** Controls the amount of spacing between this element and the preceding element
       * @displayOptions.show { type: ["textBlock"] }
       * @default default
       */
      spacing?: 'default' | 'extraLarge' | 'large' | 'medium' | 'none' | 'padding' | 'small' | Expression<string>;
      /** A unique identifier associated with the item
       * @displayOptions.show { type: ["textBlock", "inputText"] }
       */
      id?: string | Expression<string>;
      /** Whether this item will be removed from the visual trees
       * @displayOptions.show { type: ["textBlock"] }
       * @default true
       */
      isVisible?: boolean | Expression<boolean>;
      /** Whether to allow multiple lines of input
       * @displayOptions.show { type: ["inputText"] }
       * @default false
       */
      isMultiline?: boolean | Expression<boolean>;
      /** Hint of maximum length characters to collect (may be ignored by some clients)
       * @displayOptions.show { type: ["inputText"] }
       * @default 1
       */
      maxLength?: number | Expression<number>;
      /** Description of the input desired. Displayed when no text has been input.
       * @displayOptions.show { type: ["inputText"] }
       */
      placeholder?: string | Expression<string>;
      /** Regular expression indicating the required format of this text input
       * @displayOptions.show { type: ["inputText"] }
       */
      regex?: string | Expression<string>;
      /** Style hint for text input
       * @displayOptions.show { type: ["inputText"] }
       * @default text
       */
      style?: 'text' | 'tel' | 'url' | 'email' | Expression<string>;
      /** The initial value for this field
       * @displayOptions.show { type: ["inputText"] }
       */
      value?: string | Expression<string>;
    }>;
  };
      /** Actions
       * @default {}
       */
      actionsUi?: {
        /** Action
     */
    actionValues?: Array<{
      /** Type
       * @default openUrl
       */
      type?: 'execute' | 'openUrl' | 'submit' | Expression<string>;
      /** The URL to open
       * @displayOptions.show { type: ["openUrl"] }
       */
      url?: string | Expression<string>;
      /** Any extra data to pass along. These are essentially ‘hidden’ properties.
       * @displayOptions.show { type: ["submit", "execute"] }
       */
      data?: string | Expression<string>;
      /** The card author-defined verb associated with this action
       * @displayOptions.show { type: ["execute"] }
       */
      verb?: string | Expression<string>;
      /** Label for button or link that represents this action
       */
      title?: string | Expression<string>;
      /** Optional icon to be shown on the action in conjunction with the title. Supports data URI in version 1.2+.
       */
      iconUrl?: string | Expression<string>;
      /** Controls the style of an Action, which influences how the action is displayed, spoken, etc
       * @default default
       */
      style?: 'default' | 'positive' | 'destructive' | Expression<string>;
    }>;
  };
    }>;
  };
    /** File
     * @default {}
     */
    fileUi?: {
        /** File
     */
    fileValue?: {
      /** File Location
       * @default url
       */
      fileLocation?: 'url' | 'binaryData' | Expression<string>;
      /** The field in the node input containing the binary file data
       * @displayOptions.show { fileLocation: ["binaryData"] }
       * @default data
       */
      binaryPropertyName?: string | Expression<string>;
      /** The public URL of the file
       * @displayOptions.show { fileLocation: ["url"] }
       */
      url?: string | Expression<string>;
    };
  };
    /** The message in markdown format. When used the text parameter is used to provide alternate text for UI clients that do not support rich text.
     */
    markdown?: string | Expression<string>;
  };
};

export type CiscoWebexV1MessageCreateOutput = {
  created?: string;
  id?: string;
  personEmail?: string;
  personId?: string;
  roomId?: string;
  roomType?: string;
  text?: string;
};

export type CiscoWebexV1MessageCreateNode = {
  type: 'n8n-nodes-base.ciscoWebex';
  version: 1;
  config: NodeConfig<CiscoWebexV1MessageCreateParams> & { credentials?: Credentials };
  output?: Items<CiscoWebexV1MessageCreateOutput>;
};
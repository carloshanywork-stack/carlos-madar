/**
 * Box Node - Version 1
 * Discriminator: resource=file, operation=share
 */


interface Credentials {
  boxOAuth2Api: CredentialReference;
}

/** Share a file */
export type BoxV1FileShareParams = {
  resource: 'file';
  operation: 'share';
/**
 * The ID of the file to share
 */
    fileId?: string | Expression<string>;
/**
 * The type of object the file will be shared with
 */
    accessibleBy?: 'group' | 'user' | Expression<string>;
/**
 * Whether identify the user by email or ID
 * @displayOptions.show { accessibleBy: ["user"] }
 * @default true
 */
    useEmail?: boolean | Expression<boolean>;
/**
 * The user's email address to share the file with
 * @displayOptions.show { useEmail: [true], accessibleBy: ["user"] }
 */
    email?: string | Expression<string>;
/**
 * The user's ID to share the file with
 * @displayOptions.show { useEmail: [false], accessibleBy: ["user"] }
 */
    userId?: string | Expression<string>;
/**
 * The group's ID to share the file with
 * @displayOptions.show { accessibleBy: ["group"] }
 */
    groupId?: string | Expression<string>;
/**
 * The level of access granted
 * @default editor
 */
    role?: 'coOwner' | 'editor' | 'previewer' | 'previewerUploader' | 'uploader' | 'viewer' | 'viewerUploader' | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Whether the invited users can see the entire parent path to the associated folder. The user will not gain privileges in any parent folder and therefore cannot see content the user is not collaborated on.
     * @default false
     */
    can_view_path?: boolean | Expression<boolean>;
    /** Set the expiration date for the collaboration. At this date, the collaboration will be automatically removed from the item.
     */
    expires_at?: string | Expression<string>;
    /** A comma-separated list of attributes to include in the response. This can be used to request fields that are not normally returned in a standard response.
     */
    fields?: string | Expression<string>;
    /** Whether if users should receive email notification for the action performed
     * @default false
     */
    notify?: boolean | Expression<boolean>;
  };
};

export type BoxV1FileShareNode = {
  type: 'n8n-nodes-base.box';
  version: 1;
  config: NodeConfig<BoxV1FileShareParams> & { credentials?: Credentials };
};
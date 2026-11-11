/**
 * Webex by Cisco Node - Version 1 - Zod Schema
 * Discriminator: resource=message, operation=create
 *
 * Use .parse() for strict validation or .safeParse() for error handling.
 *
 * Schema helpers (z, expressionSchema, etc.) are passed as parameters
 * by the schema-validator, not imported from external files.
 *
 * @generated - CommonJS JavaScript for runtime loading
 */

module.exports = function getSchema({ parameters, z, expressionSchema, stringOrExpression, numberOrExpression, booleanOrExpression, resourceLocatorValueSchema, resourceMapperValueSchema, filterValueSchema, assignmentCollectionValueSchema, iDataObjectSchema, resolveSchema, resolveOneOfSchemas }) {

  return z.object({
    parameters: z.object({
      resource: z.literal('message').default('message'),
      operation: z.literal('create').default('create'),
      destination: z.union([z.literal('room'), z.literal('person'), expressionSchema]).optional(),
      roomId: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"destination":["room"]}}, defaults: {"destination":"room"} }),
      specifyPersonBy: resolveSchema({ parameters, schema: z.union([z.literal('email'), z.literal('id'), expressionSchema]), required: false, displayOptions: {"show":{"destination":["person"]}}, defaults: {"destination":"room"} }),
      toPersonId: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"specifyPersonBy":["id"]}}, defaults: {"specifyPersonBy":"email"} }),
      toPersonEmail: resolveSchema({ parameters, schema: stringOrExpression, required: true, displayOptions: {"show":{"specifyPersonBy":["email"]}}, defaults: {"specifyPersonBy":"email"} }),
      text: stringOrExpression,
      additionalFields: z.object({ attachmentsUi: z.object({ attachmentValues: z.array(z.object({ elementsUi: z.object({ elementValues: z.array(z.object({ type: z.union([z.literal('textBlock'), z.literal('inputText'), expressionSchema]).optional(), text: stringOrExpression.optional(), color: z.union([z.literal('accent'), z.literal('attention'), z.literal('dark'), z.literal('default'), z.literal('good'), z.literal('light'), z.literal('warning'), expressionSchema]).optional(), fontType: z.union([z.literal('default'), z.literal('monospace'), expressionSchema]).optional(), horizontalAlignment: z.union([z.literal('left'), z.literal('center'), z.literal('right'), expressionSchema]).optional(), isSubtle: booleanOrExpression.optional(), maxLines: numberOrExpression.optional(), size: z.union([z.literal('default'), z.literal('extraLarge'), z.literal('large'), z.literal('medium'), z.literal('small'), expressionSchema]).optional(), weight: z.union([z.literal('default'), z.literal('lighter'), z.literal('bolder'), expressionSchema]).optional(), wrap: booleanOrExpression.optional(), height: z.union([z.literal('auto'), z.literal('stretch'), expressionSchema]).optional(), separator: booleanOrExpression.optional(), spacing: z.union([z.literal('default'), z.literal('extraLarge'), z.literal('large'), z.literal('medium'), z.literal('none'), z.literal('padding'), z.literal('small'), expressionSchema]).optional(), id: stringOrExpression.optional(), isVisible: booleanOrExpression.optional(), isMultiline: booleanOrExpression.optional(), maxLength: numberOrExpression.optional(), placeholder: stringOrExpression.optional(), regex: stringOrExpression.optional(), style: z.union([z.literal('text'), z.literal('tel'), z.literal('url'), z.literal('email'), expressionSchema]).optional(), value: stringOrExpression.optional() })).optional() }).optional(), actionsUi: z.object({ actionValues: z.array(z.object({ type: z.union([z.literal('execute'), z.literal('openUrl'), z.literal('submit'), expressionSchema]).optional(), url: stringOrExpression.optional(), data: stringOrExpression.optional(), verb: stringOrExpression.optional(), title: stringOrExpression.optional(), iconUrl: stringOrExpression.optional(), style: z.union([z.literal('default'), z.literal('positive'), z.literal('destructive'), expressionSchema]).optional() })).optional() }).optional() })).optional() }).optional(), fileUi: z.object({ fileValue: z.object({ fileLocation: z.union([z.literal('url'), z.literal('binaryData'), expressionSchema]).optional(), binaryPropertyName: stringOrExpression.optional(), url: stringOrExpression.optional() }).optional() }).optional(), markdown: stringOrExpression.optional() }).optional(),
    }).optional(),
  });
};
/**
 * Baserow Node - Version 1 - Zod Schema
 * Discriminator: resource=row, operation=getAll
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
      resource: z.literal('row').default('row'),
      operation: z.literal('getAll').default('getAll'),
      authentication: z.union([z.literal('usernamePassword'), z.literal('databaseToken'), expressionSchema]).optional(),
      databaseId: resolveSchema({ parameters, schema: stringOrExpression, required: false, displayOptions: {"hide":{"authentication":["databaseToken"]}}, defaults: {"authentication":"usernamePassword"} }),
      tableId: stringOrExpression,
      returnAll: booleanOrExpression.optional(),
      limit: resolveSchema({ parameters, schema: numberOrExpression, required: false, displayOptions: {"show":{"returnAll":[false]}}, defaults: {"returnAll":false} }),
      additionalOptions: z.object({ filters: z.object({ fields: z.array(z.object({ field: stringOrExpression.optional(), operator: z.union([z.literal('equal'), z.literal('not_equal'), z.literal('contains'), z.literal('contains_not'), z.literal('contains_word'), z.literal('doesnt_contain_word'), z.literal('length_is_lower_than'), z.literal('higher_than'), z.literal('higher_than_or_equal'), z.literal('lower_than'), z.literal('lower_than_or_equal'), z.literal('is_even_and_whole'), z.literal('date_is'), z.literal('date_is_not'), z.literal('date_is_before'), z.literal('date_is_on_or_before'), z.literal('date_is_after'), z.literal('date_is_on_or_after'), z.literal('date_is_within'), z.literal('date_equals_today'), z.literal('date_equals_month'), z.literal('date_equals_year'), z.literal('date_equals_day_of_month'), z.literal('date_equal'), z.literal('date_not_equal'), z.literal('date_before'), z.literal('date_before_or_equal'), z.literal('date_after'), z.literal('date_after_or_equal'), z.literal('date_after_days_ago'), z.literal('date_within_days'), z.literal('date_within_weeks'), z.literal('date_within_months'), z.literal('date_equals_days_ago'), z.literal('date_equals_months_ago'), z.literal('date_equals_years_ago'), z.literal('date_before_today'), z.literal('date_after_today'), z.literal('date_equals_week'), z.literal('filename_contains'), z.literal('has_file_type'), z.literal('files_lower_than'), z.literal('single_select_equal'), z.literal('single_select_not_equal'), z.literal('single_select_is_any_of'), z.literal('single_select_is_none_of'), z.literal('multiple_select_has'), z.literal('multiple_select_has_not'), z.literal('multiple_collaborators_has'), z.literal('multiple_collaborators_has_not'), z.literal('user_is'), z.literal('user_is_not'), z.literal('link_row_has'), z.literal('link_row_has_not'), z.literal('link_row_contains'), z.literal('link_row_not_contains'), z.literal('boolean'), z.literal('empty'), z.literal('not_empty'), expressionSchema]).optional(), timezone: stringOrExpression.optional(), value: stringOrExpression.optional() })).optional() }).optional(), filterType: z.union([z.literal('AND'), z.literal('OR'), expressionSchema]).optional(), search: stringOrExpression.optional(), order: z.object({ fields: z.array(z.object({ field: stringOrExpression.optional(), direction: z.union([z.literal(''), z.literal('-'), expressionSchema]).optional() })).optional() }).optional() }).optional(),
    }).optional(),
  });
};
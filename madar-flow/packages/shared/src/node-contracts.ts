import { z } from 'zod';
import { validateExpressionsIn } from './expressions.js';
import { validateGraph } from './graph-validation.js';
import type { WorkflowGraph } from './graph.js';

export const TRIGGER_TYPES = new Set(['manual', 'webhook', 'schedule']);

export const IF_OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'greaterThan',
  'lessThan',
  'greaterOrEqual',
  'lessOrEqual',
  'exists',
  'notExists',
  'isEmpty',
  'isNotEmpty',
  'regex',
] as const;

export type IfOperator = (typeof IF_OPERATORS)[number];

export const IF_OPERATOR_LABELS: Record<IfOperator, string> = {
  equals: 'يساوي',
  notEquals: 'لا يساوي',
  contains: 'يحتوي',
  notContains: 'لا يحتوي',
  greaterThan: 'أكبر من',
  lessThan: 'أصغر من',
  greaterOrEqual: 'أكبر أو يساوي',
  lessOrEqual: 'أصغر أو يساوي',
  exists: 'موجود',
  notExists: 'غير موجود',
  isEmpty: 'فارغ',
  isNotEmpty: 'غير فارغ',
  regex: 'يطابق Regex',
};

const timezoneSchema = z.string().min(1).refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
      return true;
    } catch {
      return false;
    }
  },
  { message: 'منطقة زمنية غير معروفة.' },
);

const cronSchema = z
  .string()
  .trim()
  .min(1, 'تعبير Cron مطلوب.')
  .max(120)
  .refine(
    (value) => {
      const parts = value.trim().split(/\s+/);
      return parts.length === 5 && parts.every((part) => /^[0-9*/,\-]+$/.test(part));
    },
    { message: 'صيغة Cron يجب أن تكون 5 حقول مثل: 0 9 * * *' },
  );

const httpSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    url: z.string().trim().min(1, 'رابط الطلب مطلوب.').max(2_048),
    headers: z.record(z.string()).optional(),
    query: z.record(z.string()).optional(),
    bodyType: z.enum(['none', 'json', 'text', 'form']).optional(),
    body: z.unknown().optional(),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
    retry: z
      .object({
        maxAttempts: z.number().int().min(1).max(10),
        backoffMs: z.number().int().min(0).max(60_000),
      })
      .optional(),
    credentialId: z.string().uuid().nullable().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (!value.url.includes('{{') && !/^https?:\/\//i.test(value.url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'يجب أن يبدأ الرابط بـ http:// أو https:// أو أن يكون تعبيرًا {{ … }}.',
      });
    }
    if (value.bodyType === 'json' && typeof value.body === 'string' && value.body.trim()) {
      if (!value.body.includes('{{')) {
        try {
          JSON.parse(value.body);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['body'],
            message: 'جسم الطلب ليس JSON صالحًا.',
          });
        }
      }
    }
  });

const setSchema = z
  .object({
    values: z.record(z.unknown()),
    keepOnlySet: z.boolean().optional(),
  })
  .passthrough();

const ifConditionSchema = z
  .object({
    left: z.string().min(1, 'الطرف الأيسر مطلوب.'),
    operator: z.enum(IF_OPERATORS),
    right: z.string().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const unary = ['exists', 'notExists', 'isEmpty', 'isNotEmpty'].includes(value.operator);
    if (!unary && value.right === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['right'],
        message: 'الطرف الأيمن مطلوب لهذه العملية.',
      });
    }
  });

const ifSchema = z
  .object({
    conditions: z.array(ifConditionSchema).min(1, 'أضف شرطًا واحدًا على الأقل.'),
    combinator: z.enum(['and', 'or']).default('and'),
  })
  .passthrough();

const mergeSchema = z
  .object({
    mode: z.enum(['append', 'mergeByIndex', 'mergeByKey']),
    key: z.string().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.mode === 'mergeByKey' && !value.key?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['key'],
        message: 'حدد الحقل المستخدم للدمج.',
      });
    }
  });

const scheduleSchema = z
  .object({
    cron: cronSchema,
    timezone: timezoneSchema.default('Africa/Cairo'),
  })
  .passthrough();

const webhookSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1, 'مسار الـ Webhook مطلوب.')
      .max(120)
      .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, 'المسار يقبل الأحرف اللاتينية والأرقام و / _ - فقط.'),
    method: z.enum(['POST', 'GET', 'PUT']).default('POST'),
    credentialId: z.string().uuid().nullable().optional(),
  })
  .passthrough();

const manualSchema = z.object({}).passthrough();
const noopSchema = z.object({}).passthrough();
const errorSchema = z
  .object({
    continueOnError: z.boolean().optional(),
  })
  .passthrough();

export const NODE_CONTRACTS: Record<string, z.ZodTypeAny> = {
  manual: manualSchema,
  webhook: webhookSchema,
  schedule: scheduleSchema,
  http: httpSchema,
  set: setSchema,
  if: ifSchema,
  merge: mergeSchema,
  noop: noopSchema,
  error: errorSchema,
};

export interface NodeValidationIssue {
  path: string;
  message: string;
}

export function validateNodeParameters(
  type: string,
  parameters: Record<string, unknown> | null | undefined,
): NodeValidationIssue[] {
  const schema = NODE_CONTRACTS[type];
  if (!schema) {
    return [{ path: 'type', message: `نوع عقدة غير معروف: ${type}` }];
  }

  const result = schema.safeParse(parameters ?? {});
  if (result.success) return [];

  return result.error.issues.map((issue) => ({
    path: issue.path.join('.') || 'parameters',
    message: issue.message,
  }));
}

export interface PublishIssue {
  nodeId?: string;
  nodeName?: string;
  path?: string;
  message: string;
}

export function validateWorkflowForPublish(graph: WorkflowGraph): PublishIssue[] {
  const issues: PublishIssue[] = [];

  const structure = validateGraph(graph);
  for (const issue of structure.issues) {
    issues.push({ nodeId: issue.nodeId, message: issue.message });
  }

  const enabledNodes = graph.nodes.filter((node) => !node.disabled);
  if (!enabledNodes.some((node) => TRIGGER_TYPES.has(node.type))) {
    issues.push({ message: 'يجب أن يحتوي الـ Workflow على Trigger مفعّل واحد على الأقل.' });
  }

  const names = new Set<string>();
  for (const node of enabledNodes) {
    if (names.has(node.name)) {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        message: `اسم العقدة "${node.name}" مستخدم أكثر من مرة.`,
      });
    }
    names.add(node.name);

    for (const issue of validateNodeParameters(node.type, node.parameters)) {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        path: issue.path,
        message: issue.message,
      });
    }

    for (const issue of validateExpressionsIn(node.parameters)) {
      issues.push({
        nodeId: node.id,
        nodeName: node.name,
        path: issue.path,
        message: issue.message,
      });
    }
  }

  return issues;
}

export type NodeGroup = 'trigger' | 'action' | 'logic';

export interface NodeMeta {
  type: string;
  label: string;
  icon: string;
  group: NodeGroup;
  description: string;
  accent: string;
  hasInput: boolean;
  outputs: string[];
  defaults: Record<string, unknown>;
}

export const NODE_CATALOG: NodeMeta[] = [
  {
    type: 'manual',
    label: 'بدء يدوي',
    icon: '▶',
    group: 'trigger',
    description: 'تشغيل الـ Workflow يدويًا من الواجهة.',
    accent: 'emerald',
    hasInput: false,
    outputs: ['main'],
    defaults: {},
  },
  {
    type: 'webhook',
    label: 'Webhook',
    icon: '⇩',
    group: 'trigger',
    description: 'استقبال طلب HTTP موقّع بـ HMAC.',
    accent: 'emerald',
    hasInput: false,
    outputs: ['main'],
    defaults: { path: '', method: 'POST' },
  },
  {
    type: 'schedule',
    label: 'جدولة',
    icon: '◷',
    group: 'trigger',
    description: 'تشغيل مجدول عبر Cron مع Timezone.',
    accent: 'emerald',
    hasInput: false,
    outputs: ['main'],
    defaults: { cron: '0 9 * * *', timezone: 'Africa/Cairo' },
  },
  {
    type: 'http',
    label: 'طلب HTTP',
    icon: '⇄',
    group: 'action',
    description: 'استدعاء API خارجي مع Retries.',
    accent: 'sky',
    hasInput: true,
    outputs: ['main'],
    defaults: { method: 'GET', url: '', headers: {}, body: null, timeoutMs: 30_000 },
  },
  {
    type: 'set',
    label: 'تعيين قيم',
    icon: '{}',
    group: 'action',
    description: 'إضافة أو تعديل حقول في العناصر.',
    accent: 'violet',
    hasInput: true,
    outputs: ['main'],
    defaults: { values: {}, keepOnlySet: false },
  },
  {
    type: 'if',
    label: 'شرط IF',
    icon: '⑂',
    group: 'logic',
    description: 'تفرّع إلى مسارين حسب شرط.',
    accent: 'amber',
    hasInput: true,
    outputs: ['true', 'false'],
    defaults: { conditions: [], combinator: 'and' },
  },
  {
    type: 'merge',
    label: 'دمج',
    icon: '⇉',
    group: 'logic',
    description: 'دمج مخرجات عدة فروع.',
    accent: 'cyan',
    hasInput: true,
    outputs: ['main'],
    defaults: { mode: 'append' },
  },
  {
    type: 'noop',
    label: 'بدون عملية',
    icon: '○',
    group: 'action',
    description: 'نقطة مرور صريحة بلا تأثير.',
    accent: 'slate',
    hasInput: true,
    outputs: ['main'],
    defaults: {},
  },
  {
    type: 'error',
    label: 'مسار الخطأ',
    icon: '!',
    group: 'logic',
    description: 'معالجة أخطاء العقد المتصلة به.',
    accent: 'rose',
    hasInput: true,
    outputs: ['main'],
    defaults: { continueOnError: false },
  },
];

export const NODE_META: Record<string, NodeMeta> = Object.fromEntries(
  NODE_CATALOG.map((meta) => [meta.type, meta]),
);

export function metaFor(type: string): NodeMeta {
  return (
    NODE_META[type] ?? {
      type,
      label: type,
      icon: '◇',
      group: 'action',
      description: 'عقدة مخصصة.',
      accent: 'slate',
      hasInput: true,
      outputs: ['main'],
      defaults: {},
    }
  );
}

import type { WorkflowGraph } from './graph.js';

/**
 * The five MVP acceptance workflows from DECISIONS.md, available as
 * ready-made templates. Templates are instantiated as *drafts*: the operator
 * still has to replace placeholder URLs, attach credentials (WF2) and review
 * before publishing.
 */
export type WorkflowTemplateTrigger = 'manual' | 'webhook' | 'schedule';

export interface WorkflowTemplatePlaceholder {
  nodeId: string;
  label: string;
  parameter: 'url';
  value: string;
}

export interface WorkflowTemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger: WorkflowTemplateTrigger;
  /** Node types, in graph order, for badges in the template gallery. */
  nodeTypes: string[];
  /** Node ids that need an HMAC credential before publishing. */
  requiresHmacCredentialFor: string[];
  /** URLs the operator is expected to point at their own systems. */
  placeholders: WorkflowTemplatePlaceholder[];
}

export interface WorkflowTemplate extends WorkflowTemplateSummary {
  graph: WorkflowGraph;
}

const WF1: WorkflowTemplate = {
  id: 'wf1-health-check',
  name: 'فحص صحة النظام',
  description:
    'تشغيل يدوي يجهّز بيانات الفحص، يستدعي نقطة صحة النظام، ثم يسجّل النتيجة. يثبت المحرر والمحرك والسجلات.',
  category: 'أساسيات',
  trigger: 'manual',
  nodeTypes: ['manual', 'set', 'http', 'noop'],
  requiresHmacCredentialFor: [],
  placeholders: [
    {
      nodeId: 'wf1_check',
      label: 'عنوان فحص الصحة',
      parameter: 'url',
      value: 'https://example.com/health',
    },
  ],
  graph: {
    nodes: [
      {
        id: 'wf1_manual',
        type: 'manual',
        typeVersion: 1,
        name: 'بدء يدوي',
        position: { x: 0, y: 0 },
        parameters: {},
      },
      {
        id: 'wf1_prepare',
        type: 'set',
        typeVersion: 1,
        name: 'تجهيز بيانات الفحص',
        position: { x: 240, y: 0 },
        parameters: {
          values: {
            checkedAt: '{{ $now }}',
            source: 'manual',
          },
        },
      },
      {
        id: 'wf1_check',
        type: 'http',
        typeVersion: 1,
        name: 'فحص الحالة',
        position: { x: 480, y: 0 },
        parameters: {
          method: 'GET',
          url: 'https://example.com/health',
          timeoutMs: 10_000,
          retry: { maxAttempts: 3, backoffMs: 1_000 },
        },
      },
      {
        id: 'wf1_done',
        type: 'noop',
        typeVersion: 1,
        name: 'تسجيل النتيجة',
        position: { x: 720, y: 0 },
        parameters: {},
      },
    ],
    edges: [
      { id: 'wf1_e1', source: 'wf1_manual', target: 'wf1_prepare' },
      { id: 'wf1_e2', source: 'wf1_prepare', target: 'wf1_check' },
      { id: 'wf1_e3', source: 'wf1_check', target: 'wf1_done' },
    ],
  },
};

const WF2: WorkflowTemplate = {
  id: 'wf2-webhook-alert',
  name: 'تنبيه Webhook',
  description:
    'يستقبل تنبيهًا موقّعًا بـ HMAC، يطبّعه، يفرّق بين الخطير والعادي عبر IF، ويرسل الخطير إلى قناة خارجية. يتضمن مسار خطأ.',
  category: 'تكامل',
  trigger: 'webhook',
  nodeTypes: ['webhook', 'set', 'if', 'http', 'error', 'noop'],
  requiresHmacCredentialFor: ['wf2_webhook'],
  placeholders: [
    {
      nodeId: 'wf2_send',
      label: 'عنوان قناة التنبيهات',
      parameter: 'url',
      value: 'https://example.com/alerts',
    },
  ],
  graph: {
    nodes: [
      {
        id: 'wf2_webhook',
        type: 'webhook',
        typeVersion: 1,
        name: 'استقبال التنبيه',
        position: { x: 0, y: 0 },
        parameters: {
          path: 'alerts/incoming',
          method: 'POST',
          credentialId: null,
        },
        notes: 'أرفق اعتماد HMAC قبل النشر. يُتحقق من التوقيع على ${timestamp}.${rawBody}.',
      },
      {
        id: 'wf2_normalize',
        type: 'set',
        typeVersion: 1,
        name: 'تطبيع التنبيه',
        position: { x: 240, y: 0 },
        parameters: {
          values: {
            severity: '{{ $json.body.severity }}',
            message: '{{ $json.body.message }}',
            receivedAt: '{{ $now }}',
          },
          keepOnlySet: true,
        },
      },
      {
        id: 'wf2_if',
        type: 'if',
        typeVersion: 1,
        name: 'تصنيف الخطورة',
        position: { x: 480, y: 0 },
        parameters: {
          conditions: [
            { left: '{{ $json.severity }}', operator: 'equals', right: 'critical' },
          ],
          combinator: 'and',
        },
      },
      {
        id: 'wf2_send',
        type: 'http',
        typeVersion: 1,
        name: 'إرسال التنبيه',
        position: { x: 740, y: -120 },
        parameters: {
          method: 'POST',
          url: 'https://example.com/alerts',
          bodyType: 'json',
          body: {
            severity: '{{ $json.severity }}',
            message: '{{ $json.message }}',
          },
          timeoutMs: 15_000,
          retry: { maxAttempts: 3, backoffMs: 2_000 },
        },
      },
      {
        id: 'wf2_error',
        type: 'error',
        typeVersion: 1,
        name: 'التقاط خطأ الإرسال',
        position: { x: 980, y: 60 },
        parameters: {},
      },
      {
        id: 'wf2_done',
        type: 'noop',
        typeVersion: 1,
        name: 'تسجيل النتيجة',
        position: { x: 1_220, y: 0 },
        parameters: {},
      },
    ],
    edges: [
      { id: 'wf2_e1', source: 'wf2_webhook', target: 'wf2_normalize' },
      { id: 'wf2_e2', source: 'wf2_normalize', target: 'wf2_if' },
      { id: 'wf2_e3', source: 'wf2_if', target: 'wf2_send', sourceHandle: 'true' },
      { id: 'wf2_e4', source: 'wf2_if', target: 'wf2_done', sourceHandle: 'false' },
      { id: 'wf2_e5', source: 'wf2_send', target: 'wf2_done' },
      { id: 'wf2_e6', source: 'wf2_send', target: 'wf2_error', sourceHandle: 'error' },
      { id: 'wf2_e7', source: 'wf2_error', target: 'wf2_done' },
    ],
  },
};

const WF3: WorkflowTemplate = {
  id: 'wf3-daily-report',
  name: 'تقرير يومي',
  description:
    'تشغيل مجدول كل صباح لجلب تقرير يومي، والتحقق من جاهزيته عبر IF، وتسجيل النتيجة. يثبت الجدولة والمنطقة الزمنية.',
  category: 'تقارير',
  trigger: 'schedule',
  nodeTypes: ['schedule', 'http', 'if', 'noop'],
  requiresHmacCredentialFor: [],
  placeholders: [
    {
      nodeId: 'wf3_fetch',
      label: 'عنوان تقرير يومي',
      parameter: 'url',
      value: 'https://example.com/reports/daily',
    },
  ],
  graph: {
    nodes: [
      {
        id: 'wf3_schedule',
        type: 'schedule',
        typeVersion: 1,
        name: 'تشغيل يومي',
        position: { x: 0, y: 0 },
        parameters: {
          cron: '0 9 * * *',
          timezone: 'Africa/Cairo',
        },
      },
      {
        id: 'wf3_fetch',
        type: 'http',
        typeVersion: 1,
        name: 'جلب التقرير اليومي',
        position: { x: 240, y: 0 },
        parameters: {
          method: 'GET',
          url: 'https://example.com/reports/daily',
          timeoutMs: 30_000,
          retry: { maxAttempts: 3, backoffMs: 2_000 },
        },
      },
      {
        id: 'wf3_if',
        type: 'if',
        typeVersion: 1,
        name: 'هل التقرير جاهز؟',
        position: { x: 480, y: 0 },
        parameters: {
          conditions: [
            { left: '{{ $json.status }}', operator: 'equals', right: 'ready' },
          ],
          combinator: 'and',
        },
      },
      {
        id: 'wf3_ready',
        type: 'noop',
        typeVersion: 1,
        name: 'تسجيل الجاهزية',
        position: { x: 740, y: -100 },
        parameters: {},
      },
      {
        id: 'wf3_empty',
        type: 'noop',
        typeVersion: 1,
        name: 'لا توجد بيانات',
        position: { x: 740, y: 100 },
        parameters: {},
      },
    ],
    edges: [
      { id: 'wf3_e1', source: 'wf3_schedule', target: 'wf3_fetch' },
      { id: 'wf3_e2', source: 'wf3_fetch', target: 'wf3_if' },
      { id: 'wf3_e3', source: 'wf3_if', target: 'wf3_ready', sourceHandle: 'true' },
      { id: 'wf3_e4', source: 'wf3_if', target: 'wf3_empty', sourceHandle: 'false' },
    ],
  },
};

const WF4: WorkflowTemplate = {
  id: 'wf4-two-source-sync',
  name: 'مزامنة مصدرين',
  description:
    'يقرأ من مصدرين بالتوازي (Fan-out)، يدمج النتائج عبر Merge، يوحّد السجلات، ثم يرسل النتيجة إلى نظام الوجهة (Fan-in).',
  category: 'تكامل',
  trigger: 'manual',
  nodeTypes: ['manual', 'set', 'http', 'merge', 'http'],
  requiresHmacCredentialFor: [],
  placeholders: [
    {
      nodeId: 'wf4_source_a',
      label: 'عنوان المصدر الأول',
      parameter: 'url',
      value: 'https://example.com/source-a',
    },
    {
      nodeId: 'wf4_source_b',
      label: 'عنوان المصدر الثاني',
      parameter: 'url',
      value: 'https://example.com/source-b',
    },
    {
      nodeId: 'wf4_sink',
      label: 'عنوان نظام الوجهة',
      parameter: 'url',
      value: 'https://example.com/sync',
    },
  ],
  graph: {
    nodes: [
      {
        id: 'wf4_manual',
        type: 'manual',
        typeVersion: 1,
        name: 'بدء المزامنة',
        position: { x: 0, y: 0 },
        parameters: {},
      },
      {
        id: 'wf4_prepare',
        type: 'set',
        typeVersion: 1,
        name: 'تجهيز الطلب',
        position: { x: 240, y: 0 },
        parameters: {
          values: {
            requestedAt: '{{ $now }}',
            batch: 'full',
          },
          keepOnlySet: true,
        },
      },
      {
        id: 'wf4_source_a',
        type: 'http',
        typeVersion: 1,
        name: 'المصدر الأول',
        position: { x: 500, y: -120 },
        parameters: {
          method: 'GET',
          url: 'https://example.com/source-a',
          timeoutMs: 30_000,
          retry: { maxAttempts: 3, backoffMs: 2_000 },
        },
      },
      {
        id: 'wf4_source_b',
        type: 'http',
        typeVersion: 1,
        name: 'المصدر الثاني',
        position: { x: 500, y: 120 },
        parameters: {
          method: 'GET',
          url: 'https://example.com/source-b',
          timeoutMs: 30_000,
          retry: { maxAttempts: 3, backoffMs: 2_000 },
        },
      },
      {
        id: 'wf4_merge',
        type: 'merge',
        typeVersion: 1,
        name: 'دمج المصادر',
        position: { x: 760, y: 0 },
        parameters: { mode: 'append' },
      },
      {
        id: 'wf4_unify',
        type: 'set',
        typeVersion: 1,
        name: 'توحيد السجلات',
        position: { x: 1_000, y: 0 },
        parameters: {
          values: { syncedAt: '{{ $now }}', origin: 'madar-flow' },
        },
      },
      {
        id: 'wf4_sink',
        type: 'http',
        typeVersion: 1,
        name: 'إرسال النتيجة',
        position: { x: 1_240, y: 0 },
        parameters: {
          method: 'POST',
          url: 'https://example.com/sync',
          bodyType: 'json',
          body: '{{ $json }}',
          timeoutMs: 30_000,
          retry: { maxAttempts: 3, backoffMs: 2_000 },
        },
      },
    ],
    edges: [
      { id: 'wf4_e1', source: 'wf4_manual', target: 'wf4_prepare' },
      { id: 'wf4_e2', source: 'wf4_prepare', target: 'wf4_source_a' },
      { id: 'wf4_e3', source: 'wf4_prepare', target: 'wf4_source_b' },
      { id: 'wf4_e4', source: 'wf4_source_a', target: 'wf4_merge' },
      { id: 'wf4_e5', source: 'wf4_source_b', target: 'wf4_merge' },
      { id: 'wf4_e6', source: 'wf4_merge', target: 'wf4_unify' },
      { id: 'wf4_e7', source: 'wf4_unify', target: 'wf4_sink' },
    ],
  },
};

const WF5: WorkflowTemplate = {
  id: 'wf5-api-monitor',
  name: 'مراقبة API',
  description:
    'فحص دوري لنقطة API مع إعادة محاولة، ومسار خطأ يلتقط الفشل بعد استنفاد المحاولات، وتمييز النجاح عن التحذير عبر IF.',
  category: 'مراقبة',
  trigger: 'schedule',
  nodeTypes: ['schedule', 'http', 'if', 'set', 'error', 'noop'],
  requiresHmacCredentialFor: [],
  placeholders: [
    {
      nodeId: 'wf5_check',
      label: 'عنوان فحص الـ API',
      parameter: 'url',
      value: 'https://example.com/health',
    },
  ],
  graph: {
    nodes: [
      {
        id: 'wf5_schedule',
        type: 'schedule',
        typeVersion: 1,
        name: 'فحص كل 15 دقيقة',
        position: { x: 0, y: 0 },
        parameters: {
          cron: '*/15 * * * *',
          timezone: 'Africa/Cairo',
        },
      },
      {
        id: 'wf5_check',
        type: 'http',
        typeVersion: 1,
        name: 'فحص الـ API',
        position: { x: 240, y: 0 },
        parameters: {
          method: 'GET',
          url: 'https://example.com/health',
          timeoutMs: 10_000,
          retry: { maxAttempts: 3, backoffMs: 2_000 },
        },
      },
      {
        id: 'wf5_if',
        type: 'if',
        typeVersion: 1,
        name: 'هل الخدمة سليمة؟',
        position: { x: 480, y: 0 },
        parameters: {
          conditions: [{ left: '{{ $json.status }}', operator: 'equals', right: 'ok' }],
          combinator: 'and',
        },
      },
      {
        id: 'wf5_success',
        type: 'set',
        typeVersion: 1,
        name: 'تسجيل النجاح',
        position: { x: 740, y: -120 },
        parameters: {
          values: { checkedAt: '{{ $now }}', state: 'healthy' },
          keepOnlySet: true,
        },
      },
      {
        id: 'wf5_warning',
        type: 'set',
        typeVersion: 1,
        name: 'تسجيل التحذير',
        position: { x: 740, y: 120 },
        parameters: {
          values: { checkedAt: '{{ $now }}', state: 'degraded' },
          keepOnlySet: true,
        },
      },
      {
        id: 'wf5_error',
        type: 'error',
        typeVersion: 1,
        name: 'التقاط الفشل',
        position: { x: 480, y: 260 },
        parameters: {},
      },
      {
        id: 'wf5_done',
        type: 'noop',
        typeVersion: 1,
        name: 'إنهاء الفحص',
        position: { x: 1_000, y: 0 },
        parameters: {},
      },
    ],
    edges: [
      { id: 'wf5_e1', source: 'wf5_schedule', target: 'wf5_check' },
      { id: 'wf5_e2', source: 'wf5_check', target: 'wf5_if' },
      { id: 'wf5_e3', source: 'wf5_if', target: 'wf5_success', sourceHandle: 'true' },
      { id: 'wf5_e4', source: 'wf5_if', target: 'wf5_warning', sourceHandle: 'false' },
      { id: 'wf5_e5', source: 'wf5_success', target: 'wf5_done' },
      { id: 'wf5_e6', source: 'wf5_warning', target: 'wf5_done' },
      { id: 'wf5_e7', source: 'wf5_check', target: 'wf5_error', sourceHandle: 'error' },
      { id: 'wf5_e8', source: 'wf5_error', target: 'wf5_done' },
    ],
  },
};

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [WF1, WF2, WF3, WF4, WF5];

export function getWorkflowTemplate(templateId: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === templateId);
}

export function listWorkflowTemplateSummaries(): WorkflowTemplateSummary[] {
  return WORKFLOW_TEMPLATES.map(({ graph: _graph, ...summary }) => summary);
}

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      parameters: JSON.parse(JSON.stringify(node.parameters)) as Record<string, unknown>,
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

export interface InstantiateTemplateOptions {
  /** Credential ids keyed by node id. */
  credentialIds?: Record<string, string>;
  /** Replacement URLs keyed by node id. */
  urls?: Record<string, string>;
}

/**
 * Returns an independent copy of the template graph with operator-supplied
 * credentials and URLs applied. The template itself is never mutated.
 */
export function instantiateTemplateGraph(
  template: WorkflowTemplate,
  options: InstantiateTemplateOptions = {},
): WorkflowGraph {
  const graph = cloneGraph(template.graph);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const [nodeId, credentialId] of Object.entries(options.credentialIds ?? {})) {
    const node = byId.get(nodeId);
    if (!node) continue;
    if (!credentialId) {
      delete node.parameters.credentialId;
      continue;
    }
    node.parameters.credentialId = credentialId;
  }

  for (const [nodeId, url] of Object.entries(options.urls ?? {})) {
    const node = byId.get(nodeId);
    if (!node) continue;
    const trimmed = url.trim();
    if (trimmed) node.parameters.url = trimmed;
  }

  return graph;
}

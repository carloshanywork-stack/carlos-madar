import { Router } from 'express';
import { ZipArchive } from 'archiver';
import rateLimit from 'express-rate-limit';
import XLSX from 'xlsx';
import { requireSupervisorOrAdmin } from '../auth/authorization.js';
import { asyncHandler, HttpError } from '../http.js';
import {
  createGitHubIssueForRepBugReport,
  downloadRepBugAttachment,
  exportRepBugReports,
  getRepBugReport,
  listRepBugReports,
  updateRepBugReport,
} from '../rep/support.js';
import {
  getRepMachineLocationChangeEvidence,
  listRepMachineLocationChangeRequests,
  reviewRepMachineLocationChange,
} from '../rep/service.js';

const router = Router();
router.use(requireSupervisorOrAdmin);

const reportExportLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'تم تجاوز الحد المسموح لتصدير البلاغات. حاول مرة أخرى بعد دقيقة.' },
});
const githubIssueLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'تم تجاوز الحد المسموح لإنشاء بلاغات GitHub. حاول مرة أخرى لاحقاً.' },
});
const locationDecisionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'تم تجاوز الحد المسموح لقرارات الموقع. حاول مرة أخرى بعد دقيقة.' },
});

router.get('/rep-support/reports/export.xlsx', reportExportLimiter, (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'all';
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const reports = exportRepBugReports({ status, category, severity, from, to });
  const headers = [
    'id', 'uuid', 'representative', 'category', 'severity', 'description', 'screen',
    'appVersion', 'device', 'androidVersion', 'status', 'githubIssueUrl', 'createdAt', 'updatedAt',
  ];
  const cell = (value) => {
    if (typeof value !== 'string') return value ?? '';
    return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
  };
  const rows = reports.map((report) => ({
    id: report.id,
    uuid: report.reportUuid,
    representative: report.representativeName || report.username || report.representativeId,
    category: report.category,
    severity: report.severity,
    description: report.description,
    screen: report.screenName,
    appVersion: report.appVersion,
    device: report.deviceModel,
    androidVersion: report.androidVersion,
    status: report.status,
    githubIssueUrl: report.githubIssueUrl,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, cell(value)]),
  )), { header: headers });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Bug reports');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.set({
    'Cache-Control': 'private, no-store',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="rep-support-reports.xlsx"',
  }).send(bytes);
});

router.get('/rep-support/reports/:reportId/package.zip', reportExportLimiter, asyncHandler(async (req, res, next) => {
  const report = getRepBugReport(req.params.reportId);
  const files = [];
  for (const attachment of report.attachments.filter((item) => !item.purged)) {
    const file = await downloadRepBugAttachment(report.id, attachment.id);
    files.push({ path: file.absolutePath, name: `attachments/attachment-${attachment.id}.jpg` });
  }
  const summary = [
    `MADAR representative bug report #${report.id}`,
    `UUID: ${report.reportUuid}`,
    `Representative: ${report.representativeName || report.username || report.representativeId}`,
    `Category: ${report.category} · Severity: ${report.severity}`,
    `Status: ${report.status}`,
    `App: ${report.appVersion} · Device: ${report.deviceModel} · Android ${report.androidVersion}`,
    `Screen: ${report.screenName}`,
    `Created: ${report.createdAt} · Updated: ${report.updatedAt}`,
    '', report.description,
  ].join('\n');
  res.set({
    'Cache-Control': 'private, no-store',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="rep-bug-report-${report.id}.zip"`,
  });
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', (error) => {
    if (res.headersSent) res.destroy(error);
    else next(error);
  });
  archive.pipe(res);
  archive.append(`${JSON.stringify(report, null, 2)}\n`, { name: 'report.json' });
  archive.append(`${summary}\n`, { name: 'summary.txt' });
  for (const file of files) archive.file(file.path, { name: file.name });
  await archive.finalize();
}));

router.get('/rep-support/reports', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'all';
  const requestedLimit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
    throw new HttpError(400, 'limit must be an integer from 1 to 200.');
  }
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, reports: listRepBugReports({ status, limit: requestedLimit }) });
});

router.get('/rep-support/reports/:reportId', (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, report: getRepBugReport(req.params.reportId) });
});

router.patch('/rep-support/reports/:reportId', (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, report: updateRepBugReport(req.params.reportId, req.body, req.user.id) });
});

router.post('/rep-support/reports/:reportId/github-issue', githubIssueLimiter, asyncHandler(async (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, report: await createGitHubIssueForRepBugReport(req.params.reportId, req.user.id) });
}));

router.get('/rep-support/:reportId/attachments/:attachmentId', asyncHandler(async (req, res) => {
  const file = await downloadRepBugAttachment(req.params.reportId, req.params.attachmentId);
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': file.content_type,
    'Content-Length': String(file.byte_size),
  }).attachment(file.original_name).sendFile(file.absolutePath);
}));

router.get('/rep-location-changes', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, requests: listRepMachineLocationChangeRequests({ status }) });
});

router.get('/rep-location-changes/:requestId/evidence', asyncHandler(async (req, res) => {
  const file = await getRepMachineLocationChangeEvidence(req.params.requestId);
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': file.contentType })
    .sendFile(file.absolutePath);
}));

router.post('/rep-location-changes/:requestId/:decision', locationDecisionLimiter, asyncHandler(async (req, res) => {
  const result = await reviewRepMachineLocationChange(req.params.requestId, req.body, req.user.id, req.params.decision);
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, ...result });
}));

export default router;

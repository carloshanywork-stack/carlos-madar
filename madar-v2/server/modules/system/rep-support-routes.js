import { Router } from 'express';
import { requireAdmin } from '../auth/authorization.js';
import { asyncHandler, HttpError } from '../http.js';
import {
  createGitHubIssueForRepBugReport,
  downloadRepBugAttachment,
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
router.use(requireAdmin);

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

router.post('/rep-support/reports/:reportId/github-issue', asyncHandler(async (req, res) => {
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

router.post('/rep-location-changes/:requestId/:decision', asyncHandler(async (req, res) => {
  const result = await reviewRepMachineLocationChange(req.params.requestId, req.body, req.user.id, req.params.decision);
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  res.json({ success: true, ...result });
}));

export default router;

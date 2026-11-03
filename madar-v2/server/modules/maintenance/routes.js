import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { asyncHandler, HttpError } from '../http.js';
import { diskUpload, memoryUpload } from '../upload.js';
import { requestActorId } from '../actor.js';
import { getMaintenanceThumbnail } from './thumbnails.js';
import { ensureStorageDirectory, listStorageDirectories, removeStorageFile } from '../storage.js';
import { exportMaintenancePptx, exportMaintenanceReport, getExportProgress } from './export.js';
import { buildMaintenanceAnalysisWorkbook, getMaintenanceAreaAnalysis } from './analysis.js';
import { buildAreaMaintenanceNotesWorkbook, getAreaMaintenanceNotes } from './area-notes.js';
import {
  addMaintenanceCard,
  archiveMaintenanceOrder,
  beginMaintenanceTripProgress,
  bindUnmatchedMaintenanceFolder,
  clearMachineMaintenanceNotes,
  createMachine,
  createMaintenanceReason,
  createMaintenanceOrder,
  deactivateMachine,
  deactivateMaintenanceReason,
  deleteMaintenanceCard,
  deleteCardPhoto,
  deleteMaintenanceOrder,
  deleteUnmatchedMaintenanceFolder,
  decommissionMaintenanceMachineWithoutCard,
  disburseMaintenanceCustody,
  failMaintenanceTripProgress,
  getMaintenanceOrder,
  getMaintenanceTripProgress,
  getMaintenancePhoto,
  getUnmatchedMaintenancePhoto,
  importMachines,
  importMaintenanceServerFolder,
  listAreas,
  listMachines,
  listMaintenanceRepresentatives,
  listMaintenanceReasons,
  listMaintenanceOrders,
  moveCardPhoto,
  populateMaintenanceOrderArea,
  replaceMaintenanceOrderRepresentatives,
  processMaintenanceTripFolder,
  previewMachineImport,
  transitionMaintenanceToReview,
  updateMaintenanceCard,
  updateMaintenanceReason,
  updateMachine,
  uploadMaintenancePhoto,
} from './service.js';

const router = Router();
const NO_CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};
const photoUpload = memoryUpload({
  maxBytes: 25 * 1024 * 1024,
  extensions: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'],
}).single('photo');
const machineImportUpload = memoryUpload({ maxBytes: 50 * 1024 * 1024, extensions: ['.xlsx', '.xls', '.csv'] }).single('file');
const tripFolderUpload = diskUpload({
  maxBytes: 20 * 1024 * 1024 * 1024,
  extensions: ['.zip'],
  destination: () => ensureStorageDirectory('.incoming'),
}).single('file');

function receiveTripFolderUpload(req, res, next) {
  try {
    beginMaintenanceTripProgress(req.params.id);
    tripFolderUpload(req, res, (error) => {
      if (error) failMaintenanceTripProgress(req.params.id, 'تعذر استلام ملف الرحلة.');
      next(error);
    });
  } catch (error) {
    next(error);
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      res.status(403).json({ error: 'Administrator access is required.' });
      return;
    }
    next();
  };
}

function explorerPath(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 1024 || value.includes('\\') || value.includes('\0')) {
    throw new HttpError(400, 'Invalid Areas folder path.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.') || segment.includes(':'))) {
    throw new HttpError(400, 'Invalid Areas folder path.');
  }
  return segments.join('/');
}

router.get('/areas', (req, res) => {
  res.json(listAreas());
});

router.get('/area-notes/export.xlsx', asyncHandler(async (req, res) => {
  const workbook = await buildAreaMaintenanceNotesWorkbook({ area: req.query.area });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="Madar-Area-Maintenance.xlsx"',
    'Cache-Control': 'private, no-store',
  }).send(workbook);
}));

router.get('/area-notes', (req, res, next) => {
  try { res.json(getAreaMaintenanceNotes()); }
  catch (error) { next(error); }
});

router.get('/storage-explorer', asyncHandler(async (req, res) => {
  const currentPath = explorerPath(req.query.path);
  const storagePath = currentPath ? `Areas/${currentPath}` : 'Areas';
  let directories;
  try {
    directories = await listStorageDirectories(storagePath, { photoExtensions: ['.jpg', '.jpeg', '.png'] });
  } catch (error) {
    if (currentPath || error.status !== 404) throw error;
    directories = [];
  }

  const breadcrumbs = [{ name: 'Areas', path: '' }];
  let breadcrumbPath = '';
  for (const segment of currentPath ? currentPath.split('/') : []) {
    breadcrumbPath = breadcrumbPath ? `${breadcrumbPath}/${segment}` : segment;
    breadcrumbs.push({ name: segment, path: breadcrumbPath });
  }
  const folders = directories.map((directory) => {
    const folderPath = currentPath ? `${currentPath}/${directory.name}` : directory.name;
    return {
      ...directory,
      path: folderPath,
      fullStoragePath: `Areas/${folderPath}`,
    };
  });

  res.json({ currentPath, breadcrumbs, folders });
}));

router.get('/machines', (req, res) => {
  res.json(listMachines({ area: req.query.area, search: req.query.search ?? req.query.q, page: req.query.page, limit: req.query.limit }));
});

router.get('/representatives', requireRole('admin'), (_req, res) => {
  res.set(NO_CACHE_HEADERS);
  res.json(listMaintenanceRepresentatives());
});

router.post('/machines/import/preview', machineImportUpload, (req, res, next) => {
  try { res.json(previewMachineImport(req.file)); }
  catch (error) { next(error); }
});

router.post('/machines/import', machineImportUpload, asyncHandler(async (req, res) => {
  res.json(await importMachines(req.file, requestActorId(req)));
}));

router.post('/machines', asyncHandler(async (req, res) => {
  res.status(201).json(await createMachine(req.body, requestActorId(req)));
}));

router.patch('/machines/:id', asyncHandler(async (req, res) => {
  res.json(await updateMachine(req.params.id, req.body, requestActorId(req)));
}));

router.delete('/machines/:id', (req, res, next) => {
  try { res.json(deactivateMachine(req.params.id, requestActorId(req))); }
  catch (error) { next(error); }
});

router.delete('/machines/:id/maintenance-note', (req, res, next) => {
  try { res.json(clearMachineMaintenanceNotes(req.params.id, requestActorId(req))); }
  catch (error) { next(error); }
});

router.get('/reasons', (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive;
    if (includeInactive !== undefined && !['true', 'false', '1', '0'].includes(includeInactive)) {
      throw new HttpError(400, 'includeInactive must be true or false.');
    }
    res.json(listMaintenanceReasons({ includeInactive: includeInactive === 'true' || includeInactive === '1' }));
  } catch (error) {
    next(error);
  }
});
router.post('/reasons', (req, res, next) => {
  try { res.status(201).json(createMaintenanceReason(req.body, requestActorId(req))); }
  catch (error) { next(error); }
});
router.patch('/reasons/:id', (req, res, next) => {
  try { res.json(updateMaintenanceReason(req.params.id, req.body, requestActorId(req))); }
  catch (error) { next(error); }
});
router.delete('/reasons/:id', (req, res, next) => {
  try { res.json(deactivateMaintenanceReason(req.params.id, requestActorId(req))); }
  catch (error) { next(error); }
});

router.get('/analysis/areas', (req, res, next) => {
  try { res.json(getMaintenanceAreaAnalysis(req.query)); }
  catch (error) { next(error); }
});
router.get('/analysis/export.xlsx', (req, res, next) => {
  try {
    const workbook = buildMaintenanceAnalysisWorkbook(req.query);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="Madar-Maintenance-Analysis.xlsx"',
      'Cache-Control': 'private, no-store',
    }).send(workbook);
  } catch (error) {
    next(error);
  }
});

router.get('/orders', (req, res, next) => {
  try {
    res.set(NO_CACHE_HEADERS);
    res.json(listMaintenanceOrders(req.query.status));
  } catch (error) {
    next(error);
  }
});

router.post('/orders', (req, res, next) => {
  try {
    if (req.body?.repUserIds !== undefined && req.user?.role !== 'admin') {
      throw new HttpError(403, 'Only administrators may assign field representatives to an order.');
    }
    res.status(201).json(createMaintenanceOrder(req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.put('/orders/:id/representatives', requireRole('admin'), (req, res, next) => {
  try {
    res.json(replaceMaintenanceOrderRepresentatives(req.params.id, req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.delete('/orders/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await deleteMaintenanceOrder(req.params.id, requestActorId(req)));
}));

router.post('/orders/:id/cards', (req, res, next) => {
  try {
    res.status(201).json(addMaintenanceCard(req.params.id, req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.delete('/orders/:id/cards/:cardId', asyncHandler(async (req, res) => {
  res.json(await deleteMaintenanceCard(req.params.id, req.params.cardId, requestActorId(req)));
}));

router.delete('/orders/:id/machines/:machineId', asyncHandler(async (req, res) => {
  res.json(await decommissionMaintenanceMachineWithoutCard(
    req.params.id,
    req.params.machineId,
    requestActorId(req),
  ));
}));

router.post('/orders/:id/populate-area', (req, res, next) => {
  try { res.json(populateMaintenanceOrderArea(req.params.id, req.body, requestActorId(req))); }
  catch (error) { next(error); }
});

router.post('/orders/:id/import-server-folder', asyncHandler(async (req, res) => {
  res.json(await importMaintenanceServerFolder(req.params.id, req.body, requestActorId(req)));
}));

router.get('/orders/:id/trip-progress', (req, res, next) => {
  try { res.json(getMaintenanceTripProgress(req.params.id)); }
  catch (error) { next(error); }
});

router.post('/orders/:id/process-folder', receiveTripFolderUpload, asyncHandler(async (req, res) => {
  try {
    const result = await processMaintenanceTripFolder(req.params.id, {
      folderPath: req.body?.folderPath,
      file: req.file,
    }, requestActorId(req));
    res.json(result);
  } catch (error) {
    failMaintenanceTripProgress(req.params.id);
    throw error;
  } finally {
    if (req.file?.path) await removeStorageFile(req.file.path);
  }
}));

router.post('/orders/:id/unmatched/:folderId/bind', asyncHandler(async (req, res) => {
  res.json(await bindUnmatchedMaintenanceFolder(
    req.params.id,
    req.params.folderId,
    req.body,
    requestActorId(req),
  ));
}));

router.delete('/orders/:id/unmatched/:folderId', asyncHandler(async (req, res) => {
  res.json(await deleteUnmatchedMaintenanceFolder(
    req.params.id,
    req.params.folderId,
    requestActorId(req),
  ));
}));

router.get('/orders/:id/unmatched/:folderId/photos/:filename', asyncHandler(async (req, res) => {
  const absolutePath = await getUnmatchedMaintenancePhoto(
    req.params.id,
    req.params.folderId,
    req.query.phase,
    req.params.filename,
  );
  const type = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  }[extname(req.params.filename).toLowerCase()];
  res.set({ ...NO_CACHE_HEADERS, 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.send(await readFile(absolutePath));
}));

router.get('/export/pptx/progress', asyncHandler(async (req, res) => {
  const exportId = req.query.exportId;
  if (typeof exportId !== 'string' || !exportId.trim()) {
    throw new HttpError(400, 'exportId is required.');
  }
  res.set('Cache-Control', 'private, no-store');
  res.json(getExportProgress(exportId.trim()));
}));

router.get('/export/pptx', asyncHandler(async (req, res) => {
  await exportMaintenancePptx(req, res);
}));

router.post('/export/pptx', asyncHandler(async (req, res) => {
  await exportMaintenancePptx(req, res);
}));

router.get('/orders/:id/export.pptx', asyncHandler(async (req, res) => {
  await exportMaintenanceReport(req, res, 'pptx');
}));
router.get('/orders/:id/export.docx', asyncHandler(async (req, res) => {
  await exportMaintenanceReport(req, res, 'docx');
}));

router.post('/orders/:id/custody-advance', (req, res, next) => {
  try {
    res.status(201).json(disburseMaintenanceCustody(req.params.id, req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/cards/:cardId/photos/move', asyncHandler(async (req, res) => {
  res.json(await moveCardPhoto(
    req.params.id,
    req.params.cardId,
    req.body,
    requestActorId(req),
  ));
}));

router.post('/orders/:id/cards/:cardId/photos/:phase', photoUpload, asyncHandler(async (req, res) => {
  res.status(201).json(await uploadMaintenancePhoto(
    req.params.id,
    req.params.cardId,
    req.params.phase,
    req.file,
    requestActorId(req),
  ));
}));

router.delete('/orders/:id/cards/:cardId/photos/:phase/:filename', asyncHandler(async (req, res) => {
  res.json(await deleteCardPhoto(
    req.params.id,
    req.params.cardId,
    req.params.phase,
    req.params.filename,
    requestActorId(req),
  ));
}));

router.get('/orders/:id/cards/:cardId/photos/:phase/:filename', asyncHandler(async (req, res) => {
  const absolutePath = await getMaintenancePhoto(
    req.params.id,
    req.params.cardId,
    req.params.phase,
    req.params.filename,
  );
  const type = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  }[extname(req.params.filename).toLowerCase()];
  res.set({ ...NO_CACHE_HEADERS, 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.send(await readFile(absolutePath));
}));

router.get('/orders/:id/cards/:cardId/photos/:phase/:filename/thumbnail', asyncHandler(async (req, res) => {
  const absolutePath = await getMaintenancePhoto(
    req.params.id,
    req.params.cardId,
    req.params.phase,
    req.params.filename,
  );
  const thumbnail = await getMaintenanceThumbnail(absolutePath);
  res.set({
    'Content-Type': 'image/webp',
    ...NO_CACHE_HEADERS,
    'X-Content-Type-Options': 'nosniff',
  }).send(thumbnail);
}));

router.patch('/orders/:id/cards/:cardId', asyncHandler(async (req, res) => {
  res.json(await updateMaintenanceCard(
    req.params.id,
    req.params.cardId,
    req.body,
    requestActorId(req),
  ));
}));

router.patch('/orders/:id/status', (req, res, next) => {
  try {
    res.json(transitionMaintenanceToReview(req.params.id, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/archive', (req, res, next) => {
  try {
    res.json(archiveMaintenanceOrder(req.params.id, req.body, requestActorId(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:id', (req, res, next) => {
  try {
    res.set(NO_CACHE_HEADERS);
    res.json({ ...getMaintenanceOrder(req.params.id), canAssignRepresentatives: req.user?.role === 'admin' });
  } catch (error) {
    next(error);
  }
});

export default router;

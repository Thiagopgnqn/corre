import { Request, Response } from 'express';
import { getLibraryService } from '../library/library.service.js';

export async function listPendingFiles(req: Request, res: Response): Promise<void> {
  try {
    const pending = await getLibraryService().listPendingFiles();
    res.json({ success: true, data: pending });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al listar cola de moderación' });
  }
}

export async function listAllFiles(req: Request, res: Response): Promise<void> {
  try {
    const { status, subjectId, kind, search, page, pageSize } = req.query;
    const result = await getLibraryService().listAllFilesAdmin({
      status: status as string,
      subjectId: subjectId as string,
      kind: kind as string,
      search: search as string,
      page: page ? parseInt(page as string, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al listar catálogo' });
  }
}

export async function getPreviewUrl(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const result = await getLibraryService().getPreviewUrl(id);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al obtener previsualización' });
  }
}

export async function approveFile(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const adminUserId = req.user!.id;
    const approved = await getLibraryService().approveFile(id, adminUserId);
    res.json({ success: true, data: approved, message: 'Material aprobado y publicado exitosamente.' });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al aprobar material' });
  }
}

export async function rejectFile(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const adminUserId = req.user!.id;
    const { reason } = req.body;
    const rejected = await getLibraryService().rejectFile(id, adminUserId, reason);
    res.json({ success: true, data: rejected, message: 'Material rechazado.' });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al rechazar material' });
  }
}

export async function removeFile(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const adminUserId = req.user!.id;
    const { reason } = req.body;
    const removed = await getLibraryService().removeFile(id, adminUserId, reason);
    res.json({ success: true, data: removed, message: 'Material dado de baja.' });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al dar de baja material' });
  }
}

export async function getUploaderIdentity(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const adminUser = { id: req.user!.id, email: req.user!.email };
    const result = await getLibraryService().getUploaderIdentity(id, adminUser, req.ip);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al consultar uploader' });
  }
}

export async function suspendAuthor(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const adminUser = { id: req.user!.id, email: req.user!.email };
    const { reason } = req.body;
    const result = await getLibraryService().suspendAuthor(id, adminUser, reason, req.ip);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al suspender al autor' });
  }
}

export async function listReports(req: Request, res: Response): Promise<void> {
  try {
    const status = (req.query.status as any) || 'open';
    const reports = await getLibraryService().listReports(status);
    res.json({ success: true, data: reports });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al listar reportes' });
  }
}

export async function updateReportStatus(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const { status } = req.body;
    if (!['open', 'dismissed', 'actioned'].includes(status)) {
      res.status(400).json({ success: false, error: 'Estado de reporte inválido.' });
      return;
    }
    const updated = await getLibraryService().updateReportStatus(id, status);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al actualizar reporte' });
  }
}

export async function getLibraryStats(req: Request, res: Response): Promise<void> {
  try {
    const stats = await getLibraryService().getLibraryStats();
    res.json({ success: true, data: stats });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al obtener estadísticas de biblioteca' });
  }
}

export async function testR2Connection(req: Request, res: Response): Promise<void> {
  try {
    const adminUser = { id: req.user!.id, email: req.user!.email };
    const report = await getLibraryService().testR2Connection(adminUser, req.ip);
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(err.status || 500).json({ success: false, error: err.message || 'Error al probar conexión con R2' });
  }
}

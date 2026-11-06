import { Request, Response } from 'express';
import { getLibraryService } from './library.service.js';

export async function getTermsStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const status = await getLibraryService().getTermsStatus(userId);
    res.json({ success: true, data: status });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al consultar términos' });
  }
}

export async function acceptTerms(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const version = req.body?.version;
    const result = await getLibraryService().acceptTerms(userId, version);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al aceptar términos' });
  }
}

export async function listSubjects(req: Request, res: Response): Promise<void> {
  try {
    const planId = (req.query.planId as string) || req.user?.selectedPlanId || null;
    const subjects = await getLibraryService().listSubjectsWithCounts(planId);
    res.json({ success: true, data: subjects });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al listar materias' });
  }
}

export async function listFiles(req: Request, res: Response): Promise<void> {
  try {
    const subjectId = req.params.subjectId ? String(req.params.subjectId) : (req.query.subjectId as string | undefined);
    const { kind, year, term, professorId, hasSolution, search, sort, page, pageSize } = req.query;

    const result = await getLibraryService().listFiles(
      {
        subjectId,
        kind: kind as string,
        year: year ? parseInt(year as string, 10) : undefined,
        term: term as string,
        professorId: professorId as string,
        hasSolution: hasSolution !== undefined ? hasSolution === 'true' : undefined,
        search: search as string,
        sort: sort as any,
        page: page ? parseInt(page as string, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
      },
      req.user?.id
    );

    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al listar archivos' });
  }
}

export async function getFileDetail(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const isAdmin = req.user?.role === 'admin';
    const detail = await getLibraryService().getFileDetail(id, req.user?.id, isAdmin);
    res.json({ success: true, data: detail });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al obtener detalle del archivo' });
  }
}

export async function initUpload(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const {
      subjectId,
      kind,
      academicYear,
      term,
      examInstance,
      hasSolution,
      title,
      description,
      originalFilename,
      mimeType,
      sizeBytes,
      professorIds,
      acceptTerms,
    } = req.body;

    if (!subjectId || !kind || !title || !originalFilename || !mimeType || !sizeBytes) {
      res.status(400).json({
        success: false,
        error: 'Faltan campos obligatorios para iniciar la subida (materia, tipo, título, nombre, formato y tamaño).',
      });
      return;
    }

    const result = await getLibraryService().initUpload(userId, {
      subjectId,
      kind,
      academicYear: academicYear ? parseInt(academicYear, 10) : undefined,
      term,
      examInstance,
      hasSolution: Boolean(hasSolution),
      title,
      description,
      originalFilename,
      mimeType,
      sizeBytes: parseInt(sizeBytes, 10),
      professorIds: Array.isArray(professorIds) ? professorIds : undefined,
      acceptTerms: Boolean(acceptTerms),
    });

    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    if ((statusCode === 429 || statusCode === 503) && err.retryAfter) {
      res.setHeader('Retry-After', String(err.retryAfter));
    }
    res.status(statusCode).json({
      success: false,
      code: err.code,
      error: err.message || 'Error al inicializar la subida',
    });
  }
}

export async function completeUpload(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const fileId = req.params.id ? String(req.params.id) : (req.body?.fileId as string);

    if (!fileId) {
      res.status(400).json({ success: false, error: 'Identificador de archivo no provisto.' });
      return;
    }

    const result = await getLibraryService().completeUpload(userId, fileId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    if ((statusCode === 429 || statusCode === 503) && err.retryAfter) {
      res.setHeader('Retry-After', String(err.retryAfter));
    }
    res.status(statusCode).json({
      success: false,
      code: err.code,
      error: err.message || 'Error al finalizar la subida',
    });
  }
}

export async function downloadFile(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    const isAdmin = req.user?.role === 'admin';

    const result = await getLibraryService().getDownloadUrl(id, userId, isAdmin);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({
      success: false,
      code: err.code,
      error: err.message || 'Error al generar enlace de descarga',
    });
  }
}

export async function toggleHelpful(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);

    const result = await getLibraryService().toggleHelpful(id, userId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al votar' });
  }
}

export async function reportFile(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);
    const { reason, note } = req.body;

    if (!reason) {
      res.status(400).json({ success: false, error: 'Debés especificar el motivo del reporte.' });
      return;
    }

    const result = await getLibraryService().reportFile(id, userId, reason, note);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al enviar reporte' });
  }
}

export async function listMyUploads(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    // ?peek=1 consulta el estado sin marcar las novedades como vistas (usado por el badge del Navbar)
    const peek = req.query.peek === '1' || req.query.peek === 'true';
    const result = await getLibraryService().listMyUploads(userId, !peek);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al listar tus aportes' });
  }
}

export async function updateMyFile(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);

    const updated = await getLibraryService().updateMyFile(userId, id, req.body);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al actualizar material' });
  }
}

export async function deleteMyFile(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const id = String(req.params.id);

    const result = await getLibraryService().deleteMyFile(userId, id);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusCode = err.status || 500;
    res.status(statusCode).json({ success: false, error: err.message || 'Error al eliminar material' });
  }
}

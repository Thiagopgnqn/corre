import React from 'react';
import { ArrowLeft, ShieldCheck, AlertCircle, Mail, CheckCircle2 } from 'lucide-react';
import { APP_NAME } from '../../config/brand';

interface LibraryTermsPageProps {
  onBack: () => void;
}

export const LibraryTermsPage: React.FC<LibraryTermsPageProps> = ({ onBack }) => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 text-slate-200">
      {/* Top Navigation */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors text-xs font-semibold border border-slate-800 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a la Biblioteca
        </button>
      </div>

      {/* Header */}
      <div className="space-y-3 border-b border-slate-800 pb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-semibold">
          <ShieldCheck className="w-4 h-4 text-indigo-400" />
          Términos de Uso y Política de Propiedad Intelectual
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Biblioteca de Material de Estudio — {APP_NAME}
        </h1>
        <p className="text-sm text-slate-400 leading-relaxed max-w-2xl">
          La Biblioteca de {APP_NAME} es un espacio colaborativo desarrollado para la comunidad estudiantil de Ingeniería en Sistemas de Información (UTN FRC), cuyo único propósito es facilitar el intercambio académico libre y sin costo de recursos de aprendizaje.
        </p>
      </div>

      {/* Terms Body */}
      <div className="space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
        {/* Section 1 */}
        <section className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 space-y-2.5">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs font-mono font-bold">
              1
            </span>
            Finalidad y Gratuidad
          </h2>
          <p className="text-slate-400">
            La plataforma no cobra ni cobrará suma alguna por acceder, consultar o descargar material de estudio. No se emplean sistemas de puntos obligatorios, suscripciones comerciales ni requisitos de subida previa para poder descargar. El acceso requiere exclusivamente contar con una cuenta institucional o personal verificada.
          </p>
        </section>

        {/* Section 2 */}
        <section className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 space-y-2.5">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs font-mono font-bold">
              2
            </span>
            Material Permitido y Declaración de Autoría
          </h2>
          <p className="text-slate-400">
            Los aportes deben corresponder estrictamente a las siguientes categorías: enunciados y resoluciones de exámenes parciales o finales, resúmenes elaborados por estudiantes, apuntes de clase tomados durante la cursada y guías de trabajos prácticos.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/20 text-emerald-300 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-200">Permitido</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Apuntes propios, resoluciones de ejercicios, modelos de parcial compartidos públicamente por la cátedra.
                </p>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/20 text-rose-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-200">Prohibido</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Libros comerciales completos digitalizados, material con copyright protegido, datos sensibles o privados (teléfonos, DNIs, contraseñas).
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3 */}
        <section className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 space-y-2.5">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs font-mono font-bold">
              3
            </span>
            Moderación Previa Obligatoria
          </h2>
          <p className="text-slate-400">
            Todo material aportado queda en estado de revisión previa (<span className="text-amber-400 font-medium">pendiente</span>) y no es accesible de manera pública hasta ser verificado y aprobado por los administradores. Los archivos que incumplan las pautas o contengan código malicioso serán rechazados y borrados definitivamente de la infraestructura.
          </p>
        </section>

        {/* Section 4 */}
        <section className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 space-y-2.5">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs font-mono font-bold">
              4
            </span>
            Anonimato Estudiantil y Auditoría
          </h2>
          <p className="text-slate-400">
            Frente al resto de los estudiantes y usuarios de la plataforma, el catálogo exhibe únicamente la leyenda <span className="text-indigo-300 font-semibold">&ldquo;Subido por un estudiante&rdquo;</span>. La identidad del autor está protegida y solo puede ser consultada por los administradores en casos justificados de denuncia o infracción legal, quedando dicha consulta registrada de forma obligatoria en la auditoría inmutable del sistema.
          </p>
        </section>

        {/* Section 5: DMCA / Notice & Takedown */}
        <section className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 space-y-3">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center text-xs font-mono font-bold">
              5
            </span>
            Procedimiento de Baja por Infracción de Derechos (Notice and Takedown)
          </h2>
          <p className="text-slate-400">
            Si sos titular de derechos de autor o representás a una cátedra u organización y considerás que un archivo publicado en la Biblioteca infringe tus derechos o debe ser retirado, podés denunciarlo directamente desde el menú contextual del archivo o enviar una solicitud formal de remoción por correo electrónico.
          </p>
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-indigo-400 shrink-0" />
              <div>
                <p className="text-xs text-slate-400">Canal oficial de reclamos y contacto DMCA:</p>
                <p className="text-sm font-semibold text-white">soporte.stack.frba@gmail.com</p>
              </div>
            </div>
            <a
              href="mailto:soporte.stack.frba@gmail.com?subject=Reclamo%20de%20Material%20-%20Stack"
              className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              Enviar correo de reclamo
            </a>
          </div>
          <p className="text-[11px] text-slate-500">
            Las solicitudes debidamente identificadas se procesan dentro de las 48 horas hábiles, procediendo a la baja inmediata y preventiva del archivo denunciado.
          </p>
        </section>
      </div>

      {/* Footer Back */}
      <div className="pt-4 flex justify-end">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/30 cursor-pointer"
        >
          Entendido, volver a la Biblioteca
        </button>
      </div>
    </div>
  );
};

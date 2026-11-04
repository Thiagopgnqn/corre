with open('src/components/professors/ProfessorDetailModal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Make modal container bottom sheet friendly on mobile
content = content.replace(
    'className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto"',
    'className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-hidden"'
)

content = content.replace(
    'className="w-full max-w-4xl max-h-[92vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"',
    'className="w-full max-w-4xl max-h-[90dvh] sm:max-h-[92vh] bg-slate-900 border-t sm:border border-slate-700/80 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col"'
)

# Close button min-h-[44px] min-w-[44px]
content = content.replace(
    'className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"',
    'className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"'
)

# Header "Dejar reseña" button min-h-[44px]
content = content.replace(
    'className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"',
    'className="px-3.5 py-2 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"'
)

# Add sticky bottom bar on mobile before closing </motion.div>
sticky_footer = """
            {/* Sticky thumb-reachable footer on mobile */}
            {professor && onWriteReview && (
              <div className="sm:hidden p-3 border-t border-slate-800 bg-slate-950/95 flex items-center justify-between gap-3 shrink-0">
                <div className="text-xs text-slate-400 truncate">
                  ¿Cursaste con este docente?
                </div>
                <button
                  type="button"
                  onClick={() => onWriteReview(professor.id)}
                  className="px-4 py-2.5 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                  <span>Dejar reseña</span>
                </button>
              </div>
            )}
"""

content = content.replace(
    '            </div>\n          </motion.div>\n        </div>',
    '            </div>\n' + sticky_footer + '          </motion.div>\n        </div>'
)

with open('src/components/professors/ProfessorDetailModal.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("ProfessorDetailModal patched successfully")


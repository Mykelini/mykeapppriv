const fs = require('fs');
const file = 'src/app/page.tsx';
let code = fs.readFileSync(file, 'utf8');

console.log('Read file');

// 1. Add state for Routines and Study Blocks
code = code.replace(
  'const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);',
  'const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);\n  const [isRoutinesModalOpen, setIsRoutinesModalOpen] = useState(false);\n  const [isStudyModalOpen, setIsStudyModalOpen] = useState(false);\n  const [activeStudyBlock, setActiveStudyBlock] = useState(null);\n  const [userRoutines, setUserRoutines] = useState([]);'
);

// 2. Weekly Routine Management: Add an icon [??? Orario] in the header
// We'll search for 'title="Sincronizza Cloud"' button, and insert the Orario button before the profile button
// The header structure has Top-Right Smart Location Pill, then Profile Avatar Button.
code = code.replace(
  '{/* 2. UNIFIED APPLE PROFILE AVATAR BUTTON */}',
  \{/* 1.5 WEEKLY ROUTINE BUTTON */}
            <button
              onClick={() => setIsRoutinesModalOpen(true)}
              title="Orario e Routine"
              className="px-3 py-1.5 rounded-full flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-700 transition-all border shadow-sm mx-1"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold hidden sm:inline-block uppercase tracking-wider">Orario</span>
            </button>
            {/* 2. UNIFIED APPLE PROFILE AVATAR BUTTON */}\
);

// 3. Smart Focus Timer Card: Next to the "Aggiungi Impegno" floating button
// We search for '{/* FAB */}'
code = code.replace(
  'openNewEventModal();\\n          }}\\n          className="fixed bottom-6 right-6',
  'openNewEventModal();\\n          }}\\n          className="fixed bottom-6 right-6 z-40'
);
// Wait, better to replace the FAB section entirely
const fabRegex = /\\{\\/\\* FAB \\*\\/\\}\\s*\\{masterEvents\\.length > 0 && \\(\\s*<button[\\s\\S]*?<Plus className="w-6 h-6" \\/>\\s*<\\/button>\\s*\\)\\}/;
const newFab = \{/* FAB & STUDY BUTTON */}
      {masterEvents.length > 0 && (
        <div className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 flex flex-col items-end gap-3 z-40">
          {activeStudyBlock ? (
            <div className="bg-white px-4 py-3 rounded-[20px] shadow-lg border border-indigo-100 flex items-center gap-3 animate-in slide-in-from-right">
               <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
               <div className="flex flex-col">
                 <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Focus Attivo</span>
                 <span className="text-sm font-bold text-slate-800">{activeStudyBlock.title}</span>
               </div>
               <button onClick={() => setActiveStudyBlock(null)} className="ml-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-full text-xs font-bold transition-colors">Termina</button>
            </div>
          ) : (
            <button
              onClick={() => setIsStudyModalOpen(true)}
              className="px-4 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-full shadow-md font-bold text-sm flex items-center gap-2 transition-all"
            >
              ?? Sessione Studio
            </button>
          )}
          <button
            onClick={() => openNewEventModal()}
            className="w-[52px] h-[52px] bg-slate-900 text-white rounded-full flex items-center justify-center shadow-lg shadow-slate-900/20 hover:scale-105 active:scale-95 transition-all"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      )}\;
code = code.replace(fabRegex, newFab);

// Also empty state Aggiungi Impegno
const emptyStateRegex = /<button\\s*onClick=\\{.*?openNewEventModal.*?\\}\\s*className="w-full bg-slate-900 text-white[^>]*>\\s*<Plus[^>]*> Aggiungi Impegno\\s*<\\/button>/s;
const emptyStateNew = \<div className="w-full flex gap-3">
                <button
                  onClick={() => setIsStudyModalOpen(true)}
                  className="flex-1 bg-indigo-50 text-indigo-600 rounded-[16px] py-3.5 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm hover:scale-[1.02] transition-transform"
                >
                  ?? Studio
                </button>
                <button
                  onClick={() => openNewEventModal(selectedCalendarDate)}
                  className="flex-[2] bg-slate-900 text-white rounded-[16px] py-3.5 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm hover:scale-[1.02] transition-transform"
                >
                  <Plus className="w-4 h-4" /> Aggiungi Impegno
                </button>
              </div>\;
code = code.replace(emptyStateRegex, emptyStateNew);

// 4. Compact chips for upcomingEvents
const timelineRegex = /\\{\\/\\* TIMELINE \\*\\/\\}\\s*\\{upcomingEvents\\.length > 0 && \\([\\s\\S]*?<\\/div>\\s*\\)\\}/;
const newTimeline = \{/* TIMELINE */}
          {upcomingEvents.length > 0 && (
            <div className="mt-3">
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-1 mb-3">Prossimi Impegni</h3>
              <div className="flex flex-col gap-2">
                {upcomingEvents.map((event) => (
                  <div key={event.id} className="bg-white rounded-full px-4 py-2.5 shadow-sm border border-slate-100/60 flex justify-between items-center overflow-hidden">
                    <div className="flex items-center gap-3 truncate">
                      <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md shrink-0">
                        {event.targetTime}
                      </span>
                      <span className="font-semibold text-slate-800 text-[13px] truncate">{event.title}</span>
                      <span className="text-[11px] text-slate-400 truncate hidden sm:inline-block">&bull; {event.destinationName}</span>
                    </div>
                    {renderCardActionButtons(event)}
                  </div>
                ))}
              </div>
            </div>
          )}\;
code = code.replace(timelineRegex, newTimeline);

// Add the modals before the end of the main
const modalsHtml = \

      {/* ROUTINES MODAL */}
      {isRoutinesModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-6 sm:p-8 shadow-2xl relative">
            <button
              onClick={() => setIsRoutinesModalOpen(false)}
              className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Routine & Orario</h2>
            <p className="text-xs text-slate-500 font-medium mb-5">Gestisci le tue classi e le routine settimanali.</p>
            <div className="text-center p-4 bg-slate-50 rounded-[16px] text-slate-500 text-sm font-medium">
              <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
              Funzionalità in arrivo. (Mocked modal as requested)
            </div>
            <button onClick={() => setIsRoutinesModalOpen(false)} className="w-full mt-4 bg-slate-900 text-white rounded-[16px] py-3.5 font-semibold text-sm">Chiudi</button>
          </div>
        </div>
      )}

      {/* STUDY SESSION MODAL */}
      {isStudyModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl relative">
            <button
              onClick={() => setIsStudyModalOpen(false)}
              className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Sessione di Studio</h2>
            <p className="text-xs text-slate-500 font-medium mb-5">Avvia un timer di focus.</p>
            <button
              onClick={() => {
                setActiveStudyBlock({ title: "Studio" });
                setIsStudyModalOpen(false);
              }}
              className="w-full bg-indigo-600 text-white rounded-[16px] py-3.5 font-semibold text-sm shadow-sm"
            >
              Inizia Focus
            </button>
          </div>
        </div>
      )}
\;

code = code.replace(/<\\/main>/, modalsHtml + '\\n    </main>');

fs.writeFileSync(file, code);
console.log('Done');

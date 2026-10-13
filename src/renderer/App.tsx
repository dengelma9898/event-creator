import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, FileSpreadsheet, PlusCircle, Settings, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';

import type { SkillMetadata } from '../shared/types.js';
import { SettingsModal } from './components/SettingsModal.js';
import { OnboardingModal } from './components/OnboardingModal.js';
import { UploadConfirmModal } from './components/UploadConfirmModal.js';
import { ScrapeTab } from './components/ScrapeTab.js';
import { FilesTab } from './components/FilesTab.js';
import { AssistantTab } from './components/AssistantTab.js';
import { Background } from './components/Background.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { Badge } from './components/ui/Badge.js';
import { cn } from './lib/utils.js';
import { spring, tabSlideVariants, tapHover } from './lib/motion.js';

type TabId = 'scrape' | 'files' | 'wizard';

interface TabItem {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
}

const TABS: TabItem[] = [
  { id: 'scrape', label: 'Termine abrufen', icon: Calendar, shortcut: '1' },
  { id: 'files', label: 'Gespeicherte Dateien', icon: FileSpreadsheet, shortcut: '2' },
  { id: 'wizard', label: 'Neue Webseite anlernen', icon: PlusCircle, shortcut: '3' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('scrape');
  const [direction, setDirection] = useState<number>(0);
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string>('');

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);
  const [hasKeyConfigured, setHasKeyConfigured] = useState<boolean>(true);
  /** Dateien, mit denen der Upload-Dialog geöffnet wurde; `null` = Dialog zu. */
  const [uploadRequest, setUploadRequest] = useState<string[] | null>(null);

  const switchTab = useCallback((nextTab: TabId) => {
    setActiveTab((prev) => {
      if (prev === nextTab) return prev;
      const currentIdx = TABS.findIndex((t) => t.id === prev);
      const nextIdx = TABS.findIndex((t) => t.id === nextTab);
      setDirection(nextIdx > currentIdx ? 1 : -1);
      return nextTab;
    });
  }, []);

  // 1. Skills laden
  const loadSkills = useCallback(async () => {
    try {
      const list = await window.electronAPI.skills.list();
      setSkills(list);
      // Falls noch keine Quelle gewählt ist, die erste vorauswählen
      if (list.length > 0 && !selectedSkillId) {
        setSelectedSkillId(list[0].id);
      }
    } catch (err) {
      console.error('Fehler beim Laden der Skills:', err);
    }
  }, [selectedSkillId]);

  // 2. Ersteinrichtungs-Check
  const checkKeyStatus = useCallback(async () => {
    try {
      const configured = await window.electronAPI.apiKey.isConfigured();
      setHasKeyConfigured(configured);
      if (!configured) {
        setIsOnboardingOpen(true);
      }
    } catch {
      setHasKeyConfigured(false);
      setIsOnboardingOpen(true);
    }
  }, []);

  useEffect(() => {
    loadSkills();
    checkKeyStatus();

    // Tastaturkürzel Cmd + 1/2/3 für Tabs, Cmd + , für Einstellungen
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (e.key === '1') {
          e.preventDefault();
          switchTab('scrape');
        } else if (e.key === '2') {
          e.preventDefault();
          switchTab('files');
        } else if (e.key === '3') {
          e.preventDefault();
          switchTab('wizard');
        } else if (e.key === ',') {
          e.preventDefault();
          setIsSettingsOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Menü-Event von Electron Main-Prozess
    const unsubscribeMenu = window.electronAPI.settings?.onOpenSettings?.(() => {
      setIsSettingsOpen(true);
    });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (unsubscribeMenu) unsubscribeMenu();
    };
  }, [loadSkills, checkKeyStatus, switchTab]);

  const handleSkillSavedAndSelect = (skillId: string) => {
    loadSkills();
    setSelectedSkillId(skillId);
    switchTab('scrape');
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex flex-col h-screen select-none bg-background text-foreground overflow-hidden font-sans">
        <Background />

        {/* macOS Window Header Drag Area */}
        <header className="h-11 flex items-center justify-between px-6 pl-20 border-b border-border bg-background/95 backdrop-blur-md app-drag z-20 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold tracking-tight text-foreground">
                Nürnbergspots
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                Event Creator
              </span>
            </div>

            {/* Skill-Zähler Badge */}
            {skills.length > 0 && (
              <motion.span
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={spring.bouncy}
                className="hidden sm:inline-flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/60 border border-border px-2 py-0.5 rounded-full font-medium"
                title={`${skills.length} aktive Webseiten-Scraper bereit`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-success inline-block shadow-xs animate-pulse" />
                <span>{skills.length} {skills.length === 1 ? 'Quelle' : 'Quellen'}</span>
              </motion.span>
            )}

            {!hasKeyConfigured && (
              <Badge variant="warning" className="gap-1 text-[10px]">
                <ShieldAlert className="w-3 h-3" />
                Schlüssel fehlt
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 app-no-drag">
            <ThemeToggle />
            <motion.button
              type="button"
              {...tapHover.iconButton}
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
              title="Einstellungen & Zugänge (Cmd + ,)"
              aria-label="Einstellungen öffnen"
            >
              <Settings className="w-4 h-4 text-foreground" />
            </motion.button>
          </div>
        </header>

        {/* Navigation Tabs mit gleitendem Aktiv-Indikator */}
        <nav className="flex items-center gap-1 border-b border-border bg-background/90 px-6 py-1.5 flex-shrink-0 z-10">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => switchTab(tab.id)}
                className={cn(
                  'relative flex items-center gap-2 py-1.5 px-3.5 rounded-lg text-xs font-medium transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  isActive
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute inset-0 rounded-lg bg-muted border border-border shadow-2xs -z-10"
                    transition={spring.snappy}
                  />
                )}
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
                <kbd
                  className={cn(
                    'text-[9px] font-mono px-1 py-0.2 rounded border transition-opacity hidden md:inline-block',
                    isActive
                      ? 'border-border/80 bg-background/70 text-foreground/80'
                      : 'border-transparent text-muted-foreground/60'
                  )}
                  title={`Tastaturkürzel: Cmd + ${tab.shortcut}`}
                >
                  ⌘{tab.shortcut}
                </kbd>
              </button>
            );
          })}
        </nav>

        {/* Content Area mit sanfter Tab-Transition */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto z-10">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={activeTab}
              custom={direction}
              variants={tabSlideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="w-full"
            >
              {activeTab === 'scrape' && (
                <ScrapeTab
                  skills={skills}
                  selectedSkillId={selectedSkillId}
                  onSelectSkill={setSelectedSkillId}
                  onRefreshSkills={loadSkills}
                  onRequestUpload={setUploadRequest}
                />
              )}
              {activeTab === 'files' && (
                <FilesTab
                  onNavigateToScrape={() => switchTab('scrape')}
                  onRequestUpload={setUploadRequest}
                />
              )}
              {activeTab === 'wizard' && (
                <AssistantTab
                  onSkillSavedAndSelect={handleSkillSavedAndSelect}
                  onRefreshSkills={loadSkills}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Modals */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onKeyStatusChanged={checkKeyStatus}
        />

        <UploadConfirmModal
          isOpen={uploadRequest !== null}
          preselected={uploadRequest ?? []}
          onClose={() => setUploadRequest(null)}
        />

        <OnboardingModal
          isOpen={isOnboardingOpen}
          onSuccess={() => {
            setIsOnboardingOpen(false);
            checkKeyStatus();
          }}
        />
      </div>
    </MotionConfig>
  );
}

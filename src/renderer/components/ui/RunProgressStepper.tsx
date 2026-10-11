import React from 'react';
import { Check, Loader2, AlertCircle, Clock, MinusCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { PlanItem, StepperStep, StepperStepId } from '../../../shared/types.js';
import { cn } from '../../lib/utils.js';
import { spring } from '../../lib/motion.js';

interface RunProgressStepperProps {
  steps: StepperStep[];
  activeStepId?: StepperStepId;
  planItems?: PlanItem[];
  className?: string;
}

export const RunProgressStepper: React.FC<RunProgressStepperProps> = ({
  steps,
  planItems,
  className,
}) => {
  if (!steps || steps.length === 0) {
    return null;
  }

  const savedCount = planItems?.filter((p) => p.status === 'saved').length || 0;
  const skippedCount = planItems?.filter((p) => p.status === 'skipped').length || 0;
  const readingCount = planItems?.filter((p) => p.status === 'reading').length || 0;
  const pendingCount = planItems?.filter((p) => p.status === 'pending').length || 0;
  const totalCount = planItems?.length || 0;

  return (
    <div className={cn('space-y-3 py-1 font-sans', className)}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const isCompleted = step.status === 'completed';
        const isActive = step.status === 'active';
        const isFailed = step.status === 'failed';
        const isPending = step.status === 'pending';

        const showPlanList =
          step.id === 'extract_events' &&
          planItems &&
          planItems.length > 0 &&
          (isActive || isCompleted);

        return (
          <div key={step.id} className="relative flex items-start gap-3 group">
            {/* Vertikale Verbindungslinie zum nächsten Schritt */}
            {!isLast && (
              <div
                className="absolute left-3.5 top-7 bottom-[-12px] w-0.5 bg-border overflow-hidden"
                aria-hidden="true"
              >
                <motion.div
                  className="w-full h-full bg-success origin-top"
                  initial={false}
                  animate={{ scaleY: isCompleted ? 1 : 0 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            )}

            {/* Schritt-Icon / Indikator */}
            <motion.div
              layout
              transition={spring.bouncy}
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center shrink-0 border text-xs font-semibold z-10 shadow-2xs transition-colors duration-200',
                isCompleted && 'bg-success/15 border-success/40 text-success',
                isActive && 'bg-secondary text-secondary-foreground border-secondary shadow-xs ring-4 ring-secondary/20',
                isFailed && 'bg-destructive/15 border-destructive/40 text-destructive',
                isPending && 'bg-muted/40 border-border text-muted-foreground'
              )}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isCompleted && (
                  <motion.div
                    key="completed"
                    initial={{ scale: 0.5, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0.5 }}
                    transition={spring.bouncy}
                  >
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  </motion.div>
                )}
                {isActive && (
                  <motion.div
                    key="active"
                    initial={{ scale: 0.5 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.5 }}
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  </motion.div>
                )}
                {isFailed && (
                  <motion.div
                    key="failed"
                    initial={{ scale: 0.5 }}
                    animate={{ scale: 1 }}
                  >
                    <AlertCircle className="w-3.5 h-3.5 stroke-[2.5]" />
                  </motion.div>
                )}
                {isPending && (
                  <span className="text-[11px] font-mono">{index + 1}</span>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Schritt Text & Detail */}
            <div className="flex-1 min-w-0 pt-0.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'text-xs transition-colors duration-200 block truncate',
                    isActive && 'font-bold text-foreground',
                    isCompleted && 'font-semibold text-foreground/90',
                    isFailed && 'font-semibold text-destructive',
                    isPending && 'font-normal text-muted-foreground'
                  )}
                >
                  {step.label}
                </span>

                {isCompleted && (
                  <motion.span
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-[10px] font-semibold text-success bg-success/10 px-1.5 py-0.2 rounded shrink-0"
                  >
                    Fertig
                  </motion.span>
                )}
                {isActive && (
                  <span className="text-[10px] font-semibold text-foreground bg-secondary/30 px-1.5 py-0.2 rounded shrink-0 animate-pulse">
                    Aktiv
                  </span>
                )}
              </div>

              {step.detail && (
                <p
                  className={cn(
                    'text-[11px] leading-relaxed transition-colors duration-200',
                    isActive && 'text-foreground/80 font-medium',
                    isCompleted && 'text-muted-foreground',
                    isFailed && 'text-destructive/90',
                    isPending && 'text-muted-foreground/60'
                  )}
                >
                  {step.detail}
                </p>
              )}

              {/* Kandidaten-Checkliste unter Phase 3 */}
              <AnimatePresence>
                {showPlanList && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={spring.soft}
                    className="mt-2 pt-2 border-t border-border/60 space-y-1.5 overflow-hidden"
                  >
                    <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                      <span>
                        Kandidaten-Checkliste ({savedCount} von {totalCount} gespeichert):
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        {savedCount > 0 && (
                          <span className="text-success font-semibold">{savedCount} gesichert</span>
                        )}
                        {skippedCount > 0 && (
                          <span className="text-muted-foreground">{skippedCount} übersprungen</span>
                        )}
                        {pendingCount > 0 && (
                          <span className="text-muted-foreground/70">{pendingCount} offen</span>
                        )}
                        {readingCount > 0 && (
                          <span className="text-secondary font-semibold">1 in Arbeit</span>
                        )}
                      </div>
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1 rounded-lg border border-border/50 bg-muted/20 p-1.5">
                      {planItems.map((item) => {
                        const isItemSaved = item.status === 'saved';
                        const isItemReading = item.status === 'reading';
                        const isItemSkipped = item.status === 'skipped';
                        const isItemPending = item.status === 'pending';

                        return (
                          <motion.div
                            key={item.id}
                            layout
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={spring.snappy}
                            className={cn(
                              'flex items-center justify-between gap-2 px-2 py-1 rounded text-[11px] transition-colors',
                              isItemSaved && 'bg-success/5 text-foreground',
                              isItemReading && 'bg-secondary/15 text-foreground font-medium',
                              isItemSkipped && 'text-muted-foreground/70 bg-muted/30 line-through opacity-75',
                              isItemPending && 'text-muted-foreground/80'
                            )}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <span className="shrink-0">
                                {isItemSaved && <Check className="w-3 h-3 text-success stroke-[2.5]" />}
                                {isItemReading && <Loader2 className="w-3 h-3 text-secondary animate-spin" />}
                                {isItemSkipped && <MinusCircle className="w-3 h-3 text-muted-foreground/60" />}
                                {isItemPending && <Clock className="w-3 h-3 text-muted-foreground/40" />}
                              </span>
                              <span className="truncate" title={item.title}>
                                {item.title}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                              {item.startDate && (
                                <span className="text-muted-foreground font-mono">
                                  {item.startDate}
                                </span>
                              )}
                              {isItemSaved && (
                                <span className="text-success font-semibold px-1 py-0.2 bg-success/10 rounded text-[9px]">
                                  CSV
                                </span>
                              )}
                              {isItemSkipped && item.skipReason && (
                                <span
                                  className="text-muted-foreground/60 italic max-w-[120px] truncate text-[9px]"
                                  title={item.skipReason}
                                >
                                  {item.skipReason}
                                </span>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        );
      })}
    </div>
  );
};

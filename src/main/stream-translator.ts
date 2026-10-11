import path from 'node:path';
import type { SDKMessage, SDKToolUseMessage, TextBlock } from '@cursor/sdk';
import {
  createInitialStepperSteps,
  isCompleteLiveEvent,
  liveEventGap,
  LIVE_EVENT_KEYS,
  LIVE_EVENT_TARGETS,
  type CsvEventRecord,
  type DiagnosticReport,
  type LiveEventKey,
  type PlanItem,
  type PlanItemStatus,
  type RunPhase,
  type RunStatusUpdate,
  type SkillMetadata,
  type StepperStep,
  type StepperStepId,
  type StepperStepStatus,
} from '../shared/types.js';

export interface TranslatorCallbacks {
  onUpdate: (update: RunStatusUpdate) => void;
}

/**
 * Übersetzt rohe Events aus dem Cursor Agent SDK Stream in beruhigende Alltagssprache,
 * verwaltet die Live-Checkliste (PlanItem[]) und den 4-Phasen-Stepper.
 * Folgt dem kanonischen Glossar (CONTEXT.md).
 */
export class StreamTranslator {
  private runId: string;
  private venue: SkillMetadata;
  private phase: RunPhase = 'idle';
  private currentMessage = '';
  private eventsFound = 0;
  private newEventsCount = 0;
  private existingEventsCount = 0;
  private fileNames: string[] = [];
  private detailsForDomi?: DiagnosticReport;
  private onUpdate: (update: RunStatusUpdate) => void;
  private liveEvents: CsvEventRecord[] = [];
  private seenEventKeys = new Set<string>();
  private planItems: PlanItem[] = [];

  /** Felder, die schon einmal gemeldet wurden – verhindert Log-Flut. */
  private reportedKeys = new Set<string>();
  private skippedEvents = 0;
  private unparsedLines = 0;
  private existingEventKeys: Set<string>;
  private stepperSteps: StepperStep[] = [];
  private activeStepId: StepperStepId = 'check_inventory';

  constructor(
    runId: string,
    venue: SkillMetadata,
    onUpdate: (update: RunStatusUpdate) => void,
    existingKeys: Set<string> = new Set()
  ) {
    this.runId = runId;
    this.venue = venue;
    this.onUpdate = onUpdate;
    this.existingEventKeys = existingKeys;
    this.stepperSteps = this.initStepperSteps();
    this.setStepStatus('check_inventory', 'active', 'Prüfe gespeicherte Termine und filtere vergangene...');
    this.activeStepId = 'check_inventory';
    this.setPhase('preparing', `Bereite Terminabruf für ${this.getShortVenueName()} vor...`);
  }

  private initStepperSteps(): StepperStep[] {
    return createInitialStepperSteps(this.getDomain());
  }

  public setExistingKeys(keys: Set<string>): void {
    this.existingEventKeys = new Set(keys);
  }

  public setStepStatus(
    id: StepperStepId,
    status: StepperStepStatus,
    detail?: string
  ): void {
    this.stepperSteps = this.stepperSteps.map((step) => {
      if (step.id === id) {
        return {
          ...step,
          status,
          ...(detail !== undefined ? { detail } : {}),
        };
      }
      return step;
    });

    if (status === 'active') {
      this.activeStepId = id;
    }
  }

  public getStepperSteps(): StepperStep[] {
    return [...this.stepperSteps];
  }

  public getActiveStepId(): StepperStepId {
    return this.activeStepId;
  }

  public getPhase(): RunPhase {
    return this.phase;
  }

  public getLiveEvents(): CsvEventRecord[] {
    return [...this.liveEvents];
  }

  public getPlanItems(): PlanItem[] {
    return [...this.planItems];
  }

  public getShortVenueName(): string {
    return this.venue.name.replace(/\s*\(.*\)$/, '');
  }

  public getDomain(): string {
    if (this.venue.domain) return this.venue.domain;
    if (this.venue.targetUrl) {
      try {
        const u = new URL(this.venue.targetUrl);
        return u.hostname.replace(/^www\./, '');
      } catch {
        // ignore
      }
    }
    return 'der Webseite';
  }

  /**
   * Registriert die vom Agenten angekündigten Event-Kandidaten (z. B. aus announce_plan)
   * und erzeugt die transparente Live-Checkliste.
   */
  public setPlanCandidates(
    candidates: { title: string; startDate?: string; detailUrl?: string }[]
  ): void {
    if (!Array.isArray(candidates)) return;

    this.planItems = candidates.map((c, index) => {
      const id =
        c.detailUrl ||
        (c.title && c.startDate ? `${c.title}#${c.startDate}` : `plan-${index + 1}`);
      return {
        id,
        title: (c.title || '').trim(),
        startDate: (c.startDate || '').trim(),
        detailUrl: (c.detailUrl || '').trim(),
        status: 'pending' as PlanItemStatus,
      };
    });

    this.eventsFound = Math.max(this.eventsFound, this.planItems.length);
    this.setStepStatus('check_inventory', 'completed');
    this.setStepStatus(
      'open_website',
      'completed',
      `${this.planItems.length} Termine im Kalender entdeckt`
    );
    this.setStepStatus(
      'extract_events',
      'active',
      `Erfasse Details für ${this.planItems.length} Termine...`
    );
    this.activeStepId = 'extract_events';
    this.currentMessage = `${this.planItems.length} Termine auf ${this.getDomain()} entdeckt. Lese Details einzeln...`;
    this.emitUpdate();
  }

  /**
   * Meldet einen Zwischenschritt (z. B. aus report_step) und setzt den Status des Kandidaten auf "reading".
   */
  public reportStepMessage(message: string, candidateTitle?: string): void {
    this.currentMessage = message;

    if (candidateTitle) {
      const normTarget = candidateTitle.trim().toLowerCase();
      const item = this.planItems.find(
        (p) =>
          p.title.toLowerCase() === normTarget ||
          p.title.toLowerCase().includes(normTarget) ||
          normTarget.includes(p.title.toLowerCase())
      );
      if (item && item.status === 'pending') {
        item.status = 'reading';
      }
    }

    this.emitUpdate();
  }

  /**
   * Registriert ein erfolgreich in die CSV geschriebenes Event und aktualisiert die UI sofort.
   */
  public addEventSuccess(record: CsvEventRecord): void {
    // 1. In planItems als 'saved' markieren oder ergänzen
    const normTitle = (record.title || '').trim().toLowerCase();
    const normUrl = (record.detailUrl || '').trim().toLowerCase();
    const titleKey = `${normTitle}#${record.startDate || ''}`;

    let item = this.planItems.find(
      (p) =>
        (normUrl && p.detailUrl && p.detailUrl.toLowerCase() === normUrl) ||
        (p.title && p.startDate && `${p.title.toLowerCase()}#${p.startDate}` === titleKey) ||
        (p.title && p.title.toLowerCase() === normTitle)
    );

    if (item) {
      item.status = 'saved';
      if (!item.startDate && record.startDate) item.startDate = record.startDate;
      if (!item.detailUrl && record.detailUrl) item.detailUrl = record.detailUrl;
    } else {
      item = {
        id: record.id || `plan-${this.planItems.length + 1}`,
        title: record.title,
        startDate: record.startDate,
        detailUrl: record.detailUrl,
        status: 'saved',
      };
      this.planItems.push(item);
    }

    // 2. Zu liveEvents hinzufügen
    const key = `${record.title}#${record.startDate}`;
    this.seenEventKeys.add(key);
    if (!this.liveEvents.some((e) => e.title === record.title && e.startDate === record.startDate)) {
      this.liveEvents.push(record);
      if (record.isNew) {
        this.newEventsCount += 1;
      } else {
        this.existingEventsCount += 1;
      }
    }

    this.eventsFound = Math.max(this.eventsFound, this.liveEvents.length, this.planItems.length);

    this.setStepStatus('check_inventory', 'completed');
    this.setStepStatus('open_website', 'completed', 'Webseite erfolgreich erreicht');
    const totalGoal = this.planItems.length || this.liveEvents.length;
    this.setStepStatus(
      'extract_events',
      'active',
      `${this.liveEvents.length} von ${totalGoal} Terminen erfasst (${this.newEventsCount} neu)`
    );
    this.activeStepId = 'extract_events';

    this.currentMessage = `Termin erfasst: "${record.title}" (${this.liveEvents.length} von ${totalGoal} erfasst)`;
    this.emitUpdate();
  }

  /**
   * Registriert einen übersprungenen Kandidaten (z. B. Duplikat oder Vergangenheit).
   */
  public addEventSkipped(
    title: string,
    startDate?: string,
    detailUrl?: string,
    reason?: string
  ): void {
    const normTitle = (title || '').trim().toLowerCase();
    const normUrl = (detailUrl || '').trim().toLowerCase();
    const titleKey = startDate ? `${normTitle}#${startDate}` : '';

    let item = this.planItems.find(
      (p) =>
        (normUrl && p.detailUrl && p.detailUrl.toLowerCase() === normUrl) ||
        (titleKey && p.title && p.startDate && `${p.title.toLowerCase()}#${p.startDate}` === titleKey) ||
        (p.title && p.title.toLowerCase() === normTitle)
    );

    if (item) {
      item.status = 'skipped';
      item.skipReason = reason || 'Übersprungen';
    } else {
      this.planItems.push({
        id: detailUrl || `skip-${this.planItems.length + 1}`,
        title: title || '(ohne Titel)',
        startDate,
        detailUrl,
        status: 'skipped',
        skipReason: reason || 'Übersprungen',
      });
    }

    this.skippedEvents += 1;
    this.currentMessage = `Termin "${title || '(ohne Titel)'}" übersprungen: ${reason || 'Nicht relevant'}`;
    this.emitUpdate();
  }

  /**
   * Setzt eine neue Phase und informiert die UI.
   */
  public setPhase(phase: RunPhase, message: string): void {
    this.phase = phase;
    this.currentMessage = message;

    if (phase === 'validating') {
      this.setStepStatus('check_inventory', 'completed');
      this.setStepStatus('open_website', 'completed', 'Webseite erfolgreich geprüft');
      this.setStepStatus(
        'extract_events',
        'completed',
        `${this.liveEvents.length || this.eventsFound} Termine erfasst`
      );
      this.setStepStatus('validate_save', 'active', 'Qualitätsprüfung (csv-import-check.js)...');
      this.activeStepId = 'validate_save';
    }

    this.emitUpdate();
  }

  /**
   * Rückwärtskompatible Methode für Text-Events (z. B. aus Tests).
   */
  public addLiveEvent(data: Record<string, unknown>, rawLine = ''): void {
    this.reportUnknownKeys(data, rawLine);

    const record: CsvEventRecord = {
      id: '',
      fileName: '',
      rowIndex: this.liveEvents.length,
      title: '',
      description: '',
      startDate: '',
      endDate: '',
      startTime: '',
      endTime: '',
      location: '',
      category: '',
      price: '',
      tickets: 'nein',
      ticketUrl: '',
      email: '',
      phone: '',
      website: '',
      socialMedia: '',
      imageUrl: '',
      detailUrl: '',
      allFields: Object.fromEntries(
        Object.entries(data).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>,
    };

    for (const key of LIVE_EVENT_KEYS) {
      const target = LIVE_EVENT_TARGETS[key];
      const value = data[key];
      if (!target || typeof value !== 'string') continue;
      (record[target] as string) = value.trim();
    }

    const key = `${record.title}#${record.startDate}`;
    if (this.seenEventKeys.has(key)) return;
    this.seenEventKeys.add(key);

    if (!isCompleteLiveEvent(record)) {
      this.skipLiveEvent(record, `LIVE-Zeile ohne ${liveEventGap(record)}`);
      return;
    }

    record.id = `live-${this.liveEvents.length + 1}-${encodeURIComponent(key.slice(0, 40))}`;

    const normTitle = (record.title || '').trim().toLowerCase();
    const normDate = (record.startDate || '').trim();
    const normUrl = (record.detailUrl || '').trim().toLowerCase();
    const titleKey = normTitle && normDate ? `${normTitle}#${normDate}` : '';
    const isExisting = Boolean(
      (titleKey && this.existingEventKeys.has(titleKey)) ||
      (normUrl && this.existingEventKeys.has(normUrl))
    );

    record.isNew = !isExisting;
    this.addEventSuccess(record);
  }

  private findLiveEventObjects(text: string): { body: string }[] {
    const found: { body: string }[] = [];
    const marker = /EVENT_LIVE:\s*/g;

    while (marker.exec(text) !== null) {
      const start = marker.lastIndex;
      if (text[start] !== '{') continue;

      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let i = start; i < text.length; i++) {
        const char = text[i];

        if (inString) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') { inString = true; continue; }
        if (char === '{') depth++;
        else if (char === '}' && --depth === 0) {
          found.push({ body: text.slice(start, i + 1) });
          marker.lastIndex = i + 1;
          break;
        }
      }
    }
    return found;
  }

  private reportUnknownKeys(data: Record<string, unknown>, rawLine: string): void {
    for (const key of Object.keys(data)) {
      if (LIVE_EVENT_KEYS.includes(key as LiveEventKey) || this.reportedKeys.has(key)) continue;
      this.reportedKeys.add(key);
      console.warn(
        `[StreamTranslator] Unbekanntes LIVE-Feld "${key}". ` +
          `Erwartet werden: ${LIVE_EVENT_KEYS.join(', ')}. ` +
          `Zeile: ${rawLine.replace(/\s+/g, ' ').slice(0, 200) || '(ohne Rohzeile)'}`
      );
    }
  }

  private skipLiveEvent(record: { title: string }, reason: string): void {
    this.skippedEvents += 1;
    console.warn(
      `[StreamTranslator] LIVE-Zeile übersprungen, ${reason}: ` +
        `${(record.title || '(ohne Titel)').slice(0, 60)}`
    );
    this.currentMessage = this.skippedSummary();
    this.emitUpdate();
  }

  private skippedSummary(): string {
    const parts = [`${this.skippedEvents} Termin(e) konnten nicht verwendet werden.`];
    if (this.unparsedLines > 0) {
      parts.push(`${this.unparsedLines} Zeile(n) waren kein gültiges JSON.`);
    }
    return parts.join(' ');
  }

  public getSkippedEventCount(): number {
    return this.skippedEvents;
  }

  public noteSkippedEvents(count: number): void {
    if (count > 0) {
      this.skippedEvents += count;
      this.emitUpdate();
    }
  }

  public setLiveEvents(records: CsvEventRecord[]): void {
    for (const r of records) {
      const key = `${r.title}#${r.startDate}`;
      if (!this.seenEventKeys.has(key)) {
        this.seenEventKeys.add(key);
        if (r.isNew === undefined) {
          const normTitle = (r.title || '').trim().toLowerCase();
          const normDate = (r.startDate || '').trim();
          const normUrl = (r.detailUrl || '').trim().toLowerCase();
          const titleKey = normTitle && normDate ? `${normTitle}#${normDate}` : '';
          const isExisting = Boolean(
            (titleKey && this.existingEventKeys.has(titleKey)) ||
            (normUrl && this.existingEventKeys.has(normUrl))
          );
          r.isNew = !isExisting;
        }
        this.liveEvents.push(r);
        if (r.isNew) {
          this.newEventsCount += 1;
        } else {
          this.existingEventsCount += 1;
        }
      }
    }
    this.eventsFound = Math.max(this.eventsFound, this.liveEvents.length);
    this.emitUpdate();
  }

  public handleSdkMessage(message: SDKMessage): void {
    if (!message) return;

    switch (message.type) {
      case 'tool_call':
        this.handleToolCall(message as SDKToolUseMessage);
        break;

      case 'assistant':
        this.handleAssistantMessage(message);
        break;

      case 'thinking':
        if (message.text) {
          this.parseLiveEventsFromText(message.text);
          this.parseEventNumbers(message.text);
        }
        break;

      case 'status':
        if (message.status === 'ERROR') {
          this.setPhase('failed', 'Hier hat etwas nicht geklappt. Frag Domi wie das geht.');
        }
        break;
    }
  }

  private handleToolCall(toolCall: SDKToolUseMessage): void {
    const name = toolCall.name.toLowerCase();
    const mcpSubTool = (toolCall.args as any)?.toolName || '';
    const toolArgs = (toolCall.args as any)?.args || toolCall.args || {};

    if (name.includes('navigate') || mcpSubTool.includes('navigate')) {
      this.phase = 'reading';
      const targetUrl = toolArgs.url || '';
      if (targetUrl.includes('/detail/')) {
        const slug = targetUrl.split('/').filter(Boolean).pop() || '';
        this.currentMessage = `Lade Detailseite: ${slug.slice(0, 35)}...`;
      } else if (targetUrl) {
        this.currentMessage = `Öffne ${targetUrl.replace(/^https?:\/\//, '').slice(0, 45)}...`;
      } else {
        this.currentMessage = `Öffne ${this.getDomain()} im Hintergrund...`;
      }
      this.emitUpdate();
      return;
    }

    if (name.includes('click') || mcpSubTool.includes('click') || name.includes('find') || mcpSubTool.includes('find')) {
      const elemText = String(toolArgs.text || toolArgs.element || toolArgs.target || '');
      if (/mehr|laden|load/i.test(elemText)) {
        this.currentMessage = 'Lade weitere Termine auf der Webseite nach...';
      } else if (elemText) {
        this.currentMessage = `Klicke auf "${elemText.slice(0, 30)}"...`;
      }
      this.emitUpdate();
    }
  }

  private handleAssistantMessage(msg: { message: { content: Array<TextBlock | { type: string }> } }): void {
    const textBlocks = msg.message?.content?.filter((b): b is TextBlock => b.type === 'text') || [];
    for (const block of textBlocks) {
      this.parseLiveEventsFromText(block.text);
      this.parseEventNumbers(block.text);

      const fileMatches = block.text.match(/data\/[a-zA-Z0-9_\-]+\.csv/g);
      if (fileMatches) {
        for (const f of fileMatches) {
          const name = path.basename(f);
          if (!this.fileNames.includes(name)) {
            this.fileNames.push(name);
          }
        }
      }
    }
  }

  private parseLiveEventsFromText(text: string): void {
    if (!text) return;

    for (const match of this.findLiveEventObjects(text)) {
      try {
        this.addLiveEvent(JSON.parse(match.body), match.body);
      } catch {
        this.unparsedLines += 1;
        console.warn(
          `[StreamTranslator] LIVE-Zeile ist kein gültiges JSON: ` +
            `${match.body.replace(/\s+/g, ' ').slice(0, 200)}`
        );
      }
    }

    const jsonBlockMatches = text.matchAll(/\{[\s\S]*?"(?:title|Titel)"\s*:\s*"([^"]+)"[\s\S]*?\}/g);
    for (const match of jsonBlockMatches) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.title || parsed.Titel) {
          this.addLiveEvent(parsed);
        }
      } catch {
        // ignore partial JSON
      }
    }
  }

  private parseEventNumbers(text: string): void {
    const newMatch = text.match(/(\d+)\s+(?:neue(?:n)?|neugefundene(?:n)?)\s+(?:Termine|Events|Veranstaltungen)/i);
    if (newMatch) {
      this.newEventsCount = parseInt(newMatch[1], 10);
    }

    const existingMatch = text.match(/(\d+)\s+(?:bestehende(?:n)?|vorhandene(?:n)?|übernommene(?:n)?)\s+(?:Termine|Events|Veranstaltungen)/i);
    if (existingMatch) {
      this.existingEventsCount = parseInt(existingMatch[1], 10);
    }

    const foundMatch = text.match(/(\d+)\s+(?:Termine|Events|Veranstaltungen)\s+(?:gefunden|gesammelt|extrahiert|geladen)/i);
    if (foundMatch) {
      const count = parseInt(foundMatch[1], 10);
      if (count > this.eventsFound) {
        this.eventsFound = count;
      }
    }
  }

  public setCompleted(newCount: number, existingCount: number, files: string[]): void {
    this.phase = 'completed';
    this.newEventsCount = newCount;
    this.existingEventsCount = existingCount;
    this.fileNames = files.map((f) => path.basename(f));

    this.setStepStatus('check_inventory', 'completed');
    this.setStepStatus('open_website', 'completed', 'Webseite erfolgreich geprüft');
    this.setStepStatus(
      'extract_events',
      'completed',
      `${this.liveEvents.length || newCount + existingCount} Termine erfasst`
    );
    this.setStepStatus(
      'validate_save',
      'completed',
      existingCount > 0
        ? `${newCount} neu, ${existingCount} Bestand gesichert`
        : `${newCount} Termine fehlerfrei gesichert`
    );
    this.activeStepId = 'validate_save';

    if (existingCount > 0) {
      this.currentMessage = `Fertig! ${newCount} neue Termine wurden hinzugefügt (${existingCount} bestehende Termine bleiben erhalten).`;
    } else {
      this.currentMessage = `Fertig! ${newCount} Termine wurden sauber gespeichert.`;
    }

    this.appendSkippedNote();
    this.emitUpdate();
  }

  public setFailed(technicalError: string, files: string[] = []): void {
    this.phase = 'failed';
    this.currentMessage = 'Hier hat etwas nicht geklappt. Frag Domi wie das geht.';

    this.setStepStatus(this.activeStepId, 'failed', 'Schritt fehlgeschlagen');

    const now = new Date();
    const formattedTimestamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const fileNames = files.map((f) => path.basename(f));

    const formattedText = [
      '=== Details für Domi ===',
      `Zeitpunkt: ${formattedTimestamp}`,
      `Quelle: ${this.venue.name} (${this.venue.id})`,
      `Phase: ${this.phase}`,
      `Fehler: ${technicalError.replace(/\r?\n/g, ' ').slice(0, 300)}`,
      `Beteiligte Dateien: ${fileNames.length > 0 ? fileNames.join(', ') : 'keine'}`,
      '========================',
    ].join('\n');

    this.detailsForDomi = {
      timestamp: formattedTimestamp,
      venueName: this.venue.name,
      venueId: this.venue.id,
      phase: this.phase,
      technicalError,
      outputFiles: files,
      formattedText,
    };

    this.emitUpdate();
  }

  public setCancelled(files: string[] = []): void {
    this.phase = 'cancelled';
    if (files.length > 0) {
      this.fileNames = files.map((f) => path.basename(f));
    }
    this.setStepStatus(this.activeStepId, 'failed', 'Vorgang beendet');

    if (this.liveEvents.length > 0) {
      this.currentMessage = `Vorgang wurde beendet. ${this.liveEvents.length} Termine wurden in der CSV gesichert.`;
    } else {
      this.currentMessage = 'Vorgang wurde beendet. Bereits gespeicherte Termine bleiben erhalten.';
    }
    this.appendSkippedNote();
    this.emitUpdate();
  }

  private appendSkippedNote(): void {
    if (this.skippedEvents > 0) {
      this.currentMessage +=
        ` ${this.skippedEvents} Termin(e) entsprachen nicht den Regeln (z. B. vergangen oder ohne Titel) und wurden übersprungen.`;
    }
    if (this.unparsedLines > 0) {
      this.currentMessage += ` ${this.unparsedLines} Zeile(n) waren kein gültiges JSON.`;
    }
  }

  private emitUpdate(): void {
    const update: RunStatusUpdate = {
      runId: this.runId,
      venueId: this.venue.id,
      venueName: this.venue.name,
      phase: this.phase,
      message: this.currentMessage,
      eventsFound: Math.max(this.eventsFound, this.liveEvents.length, this.planItems.length),
      newEventsCount: this.newEventsCount,
      existingEventsCount: this.existingEventsCount,
      fileNames: [...this.fileNames],
      detailsForDomi: this.detailsForDomi,
      liveEvents: [...this.liveEvents],
      skippedEvents: this.skippedEvents,
      stepperSteps: [...this.stepperSteps],
      activeStepId: this.activeStepId,
      planItems: [...this.planItems],
    };
    this.onUpdate(update);
  }
}

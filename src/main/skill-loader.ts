import fs from 'node:fs';
import path from 'node:path';
import type { SkillMetadata } from '../shared/types.js';
import { AppPaths } from './app-paths.js';

const EXCLUDED_SKILL_DIRS = new Set([
  'csv-handling',
  'event-category-mapper',
  'scraper-playbook',
  'scraper-orchestrator',
  'crawlee-scraper-creator',
  'find-skills',
  'create-skill',
]);

/**
 * Bekannte Anzeigenamen für Standard-Quellen (Fallback & Verfeinerung)
 */
const KNOWN_VENUE_NAMES: Record<string, string> = {
  'curt-termine-scraper': 'Curt Termine (curt.de)',
  'e-werk-scraper': 'E-Werk Erlangen (e-werk.de)',
  'frankenkids-scraper': 'Frankenkids (frankenkids.de)',
  'franmeisters-scraper': 'Franmeisters (franmeisters.de)',
  'fuerth-veranstaltungen-scraper': 'Fürth Veranstaltungen (fuerth.de)',
  'gate-nuernberg-scraper': 'GATE Nürnberg (gate-nuernberg.de)',
  'meistersingerhalle-scraper': 'Meistersingerhalle (meistersingerhalle.nuernberg.de)',
  'parks-nuernberg-scraper': 'PARKS Nürnberg (parks-nuernberg.de)',
  'rausgegangen-ausstellung-scraper': 'Rausgegangen Ausstellung (rausgegangen.de)',
  'rausgegangen-markt-scraper': 'Rausgegangen Markt (rausgegangen.de)',
  'rausgegangen-party-scraper': 'Rausgegangen Party (rausgegangen.de)',
  'z-bau-scraper': 'Z-Bau Nürnberg (z-bau.com)',
};

/**
 * Liest Frontmatter und Metadaten aus den SKILL.md-Dateien der App.
 * Implementiert AP 2.2 für die Quellenauswahl im Frontend.
 */
export class SkillLoader {
  private skillsDir: string;
  private userSkillsDir: string | null = null;
  /**
   * Die Skills im Arbeitsordner des Agenten. Im Entwicklungsbetrieb ist das
   * dieselbe wie `skillsDir`; in der gepackten App ist es eine Spiegelung des
   * mitgelieferten Satzes plus alles, was der Agent während eines Laufs
   * anlegt oder bearbeitet – und das sonst nirgends auftauchen würde.
   */
  private workspaceSkillsDir: string | null = null;

  constructor(customSkillsDir?: string) {
    const paths = AppPaths.getInstance();
    this.skillsDir = customSkillsDir || paths.skillsDir;
    this.userSkillsDir = paths.getUserSkillsDir();

    const candidate = path.join(paths.repoRoot, 'skills');
    if (candidate !== this.skillsDir && fs.existsSync(candidate)) {
      this.workspaceSkillsDir = candidate;
    }
  }

  public getSkillsDir(): string {
    return this.skillsDir;
  }

  public getUserSkillsDir(): string | null {
    return this.userSkillsDir;
  }

  /**
   * Liest alle verfügbaren Quellen-Skills aus dem skills-Ordner
   * (sowie ggf. nutzergenerierte Skills aus userData/skills).
   */
  public listSkills(): SkillMetadata[] {
    // Reihenfolge = Vorrang. Der Arbeitsordner kommt vor dem mitgelieferten
    // Satz, damit eine vom Agenten bearbeitete Quelle nicht hinter der
    // unveränderten Auslieferung verschwindet. Nutzer-Skills bleiben wie bisher
    // hinter dem mitgelieferten Satz.
    const scanDirs = [this.workspaceSkillsDir, this.skillsDir].filter(
      (d): d is string => Boolean(d)
    );
    if (this.userSkillsDir && fs.existsSync(this.userSkillsDir)) {
      scanDirs.push(this.userSkillsDir);
    }

    const seenIds = new Set<string>();
    const skills: SkillMetadata[] = [];

    for (const dir of scanDirs) {
      if (!fs.existsSync(dir)) continue;

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (EXCLUDED_SKILL_DIRS.has(entry.name)) continue;
        if (seenIds.has(entry.name)) continue;

        const skillPath = path.join(dir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillPath)) continue;

        try {
          const metadata = this.parseSkillFile(entry.name, skillPath);
          if (metadata) {
            seenIds.add(entry.name);
            skills.push(metadata);
          }
        } catch (error) {
          console.error(`[SkillLoader] Fehler beim Parsen von ${skillPath}:`, error);
        }
      }
    }

    // Alphabetische Sortierung nach Anzeigename
    return skills.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  /**
   * Sucht einen spezifischen Skill anhand seiner ID.
   */
  public getSkill(skillId: string): SkillMetadata | null {
    // 1. Zuerst in skillsDir
    const skillPath = path.join(this.skillsDir, skillId, 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      return this.parseSkillFile(skillId, skillPath);
    }

    // 2. Danach in userSkillsDir falls vorhanden
    if (this.userSkillsDir) {
      const userSkillPath = path.join(this.userSkillsDir, skillId, 'SKILL.md');
      if (fs.existsSync(userSkillPath)) {
        return this.parseSkillFile(skillId, userSkillPath);
      }
    }

    return null;
  }

  private parseSkillFile(skillId: string, skillFilePath: string): SkillMetadata | null {
    const content = fs.readFileSync(skillFilePath, 'utf8');

    // Frontmatter extrahieren (--- ... ---)
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let frontmatterName = '';
    let frontmatterDesc = '';

    if (frontmatterMatch) {
      const frontmatterContent = frontmatterMatch[1];
      const nameMatch = frontmatterContent.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        frontmatterName = nameMatch[1].trim();
      }

      const descMatch = frontmatterContent.match(/^description:\s*([\s\S]+?)(?=\n[a-z]+:|$)/m);
      if (descMatch) {
        frontmatterDesc = descMatch[1].replace(/\r?\n\s*/g, ' ').trim();
      }
    }

    // H1 Titel finden
    const h1Match = content.match(/^#\s+(.+)$/m);
    let h1Title = h1Match ? h1Match[1].trim() : '';
    // Optional "Scraper" am Ende entfernen falls vorhanden
    if (h1Title.endsWith(' Scraper')) {
      h1Title = h1Title.slice(0, -8).trim();
    }

    // URL finden (entweder in description oder im Text)
    const urlMatch = content.match(/https?:\/\/[^\s)"]+/i);
    const targetUrl = urlMatch ? urlMatch[0] : undefined;

    let domain: string | undefined;
    if (targetUrl) {
      try {
        const parsed = new URL(targetUrl);
        domain = parsed.hostname.replace(/^www\./, '');
      } catch {
        // Ignorieren bei ungültiger URL
      }
    }

    // Anzeigename bestimmen
    let displayName = KNOWN_VENUE_NAMES[skillId];
    if (!displayName) {
      if (h1Title && domain) {
        displayName = `${h1Title} (${domain})`;
      } else if (h1Title) {
        displayName = h1Title;
      } else if (frontmatterName) {
        displayName = frontmatterName;
      } else {
        displayName = skillId;
      }
    }

    return {
      id: skillId,
      name: displayName,
      description: frontmatterDesc || h1Title || skillId,
      targetUrl,
      domain,
      skillPath: skillFilePath,
    };
  }
}

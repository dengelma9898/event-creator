/**
 * Attrappe für `@cursor/sdk` im Testlauf.
 *
 * Das Paket lässt sich nicht bündeln (dynamische Importe) und wird von den
 * Modulen importiert, die `ipc.ts` braucht (`agent-runner`, `assistant-service`,
 * `agent-store`). Die Suites rufen keinen Agenten auf – sie prüfen die
 * Zuordnung Kanal -> Handler – deshalb genügen hier Leerbauten.
 */

export class Agent {
  async run(): Promise<never> {
    throw new Error('Agent läuft im Test nicht.');
  }
}

export class Cursor {
  async query(): Promise<never> {
    throw new Error('Cursor läuft im Test nicht.');
  }
}

export class JsonlLocalAgentStore {
  constructor(_dir?: string) {}
}

export const MESSAGES = {};

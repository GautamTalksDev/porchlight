/**
 * Needs-aware check-in guidance for responders.
 * Pure and browser-safe: no Node built-ins. Practical tips only, never medical advice.
 */

/** Need ids that produce a guidance line, in display order. */
export const GUIDANCE_NEED_ORDER = [
  "oxygen-concentrator",
  "dialysis-at-home",
  "insulin-refrigeration",
  "mobility-aid",
  "infant",
  "hearing-impaired",
] as const;

export const GUIDANCE_BY_NEED: Record<(typeof GUIDANCE_NEED_ORDER)[number], string> = {
  "oxygen-concentrator": "Bring a charged backup battery or check their spare oxygen supply.",
  "dialysis-at-home": "Power is needed within hours. Ask whether a hospital transfer is planned.",
  "insulin-refrigeration": "Bring a cooler with ice for their insulin.",
  "mobility-aid": "Allow time to reach the door. They may need help leaving.",
  infant: "Check the home is warm and there is safe water for formula.",
  "hearing-impaired": "Knock firmly and use visual signals. Do not rely on a phone call.",
};

/** Needs that never produce a guidance line on their own (lives alone, over 90). */
export const GUIDANCE_SKIP_NEEDS = ["lives-alone", "age-90-plus"] as const;

export const VOICE_UNSUITABLE_NEED = "hearing-impaired";
export const VOICE_UNSUITABLE_NOTE = "Voice call not suitable: hard of hearing";
export const CHECK_IN_REFUSE_REPLY = "A voice call is not suitable for this home. Shall I send someone?";
export const CHECK_IN_START_REPLY = "Starting the check-in call now.";

export interface NeedsGuidance {
  voiceCallSuitable: boolean;
  /** Short note for the UI when a voice call is not suitable. */
  voiceUnsuitableNote: string | null;
  /** Practical responder lines for "What to bring". */
  lines: string[];
}

/** Build guidance and voice suitability from a home's need ids. */
export function guidanceForNeeds(needs: readonly string[]): NeedsGuidance {
  const set = new Set(needs);
  const lines: string[] = [];
  for (const id of GUIDANCE_NEED_ORDER) {
    if (set.has(id)) lines.push(GUIDANCE_BY_NEED[id]);
  }
  const unsuitable = set.has(VOICE_UNSUITABLE_NEED);
  return {
    voiceCallSuitable: !unsuitable,
    voiceUnsuitableNote: unsuitable ? VOICE_UNSUITABLE_NOTE : null,
    lines,
  };
}

/** Copilot start_check_in: either start a call, or refuse and offer to send someone. */
export function startCheckInCopilotDecision(needs: readonly string[]): {
  startCall: boolean;
  reply: string;
} {
  const g = guidanceForNeeds(needs);
  if (!g.voiceCallSuitable) {
    return { startCall: false, reply: CHECK_IN_REFUSE_REPLY };
  }
  return { startCall: true, reply: CHECK_IN_START_REPLY };
}

/**
 * Browser-safe copy of apps/city/lib/needs-guidance.ts for the node console (offline).
 * Keep identical: apps/city/test/needs-guidance-drift.test.ts checks for drift.
 */

export const GUIDANCE_NEED_ORDER = [
  "oxygen-concentrator",
  "dialysis-at-home",
  "insulin-refrigeration",
  "mobility-aid",
  "infant",
  "hearing-impaired",
];

export const GUIDANCE_BY_NEED = {
  "oxygen-concentrator": "Bring a charged backup battery or check their spare oxygen supply.",
  "dialysis-at-home": "Power is needed within hours. Ask whether a hospital transfer is planned.",
  "insulin-refrigeration": "Bring a cooler with ice for their insulin.",
  "mobility-aid": "Allow time to reach the door. They may need help leaving.",
  infant: "Check the home is warm and there is safe water for formula.",
  "hearing-impaired": "Knock firmly and use visual signals. Do not rely on a phone call.",
};

export const GUIDANCE_SKIP_NEEDS = ["lives-alone", "age-90-plus"];

export const VOICE_UNSUITABLE_NEED = "hearing-impaired";
export const VOICE_UNSUITABLE_NOTE = "Voice call not suitable: hard of hearing";
export const CHECK_IN_REFUSE_REPLY = "A voice call is not suitable for this home. Shall I send someone?";
export const CHECK_IN_START_REPLY = "Starting the check-in call now.";

/** Build guidance and voice suitability from a home's need ids. */
export function guidanceForNeeds(needs) {
  const set = new Set(needs ?? []);
  const lines = [];
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
export function startCheckInCopilotDecision(needs) {
  const g = guidanceForNeeds(needs);
  if (!g.voiceCallSuitable) {
    return { startCall: false, reply: CHECK_IN_REFUSE_REPLY };
  }
  return { startCall: true, reply: CHECK_IN_START_REPLY };
}

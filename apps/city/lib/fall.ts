/** Same text the protocol package puts on fall help events. Kept here so the browser can use it without importing protocol. */
export const FALL_NOTE = "Possible fall detected by the beacon. No button was pressed.";

export function isFall(note?: string): boolean {
  return note === FALL_NOTE;
}

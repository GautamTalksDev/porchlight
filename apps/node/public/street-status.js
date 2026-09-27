/**
 * Street card status line for the node console: status first, then sign of life.
 */

export function houseStatusParts(h) {
  const status = h.statusText ?? h.status ?? "Unknown";
  const sign = h.signOfLife || null;
  if (sign) {
    return {
      primary: status,
      secondary: sign,
      aria: `${h.label}: ${status}. ${sign}`,
    };
  }
  return {
    primary: status,
    secondary: null,
    aria: `${h.label}: ${status}`,
  };
}

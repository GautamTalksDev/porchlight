import { CITY_BROADCAST_HOUSEHOLD, isStreetHousehold } from "@porchlight/protocol";

export { CITY_BROADCAST_HOUSEHOLD, isStreetHousehold };

/** Drop the city broadcast household from any list keyed by id or household. */
export function withoutBroadcastHousehold<T extends { id?: string; household?: string }>(list: T[]): T[] {
  return list.filter((item) => {
    const key = item.id ?? item.household;
    return key == null || isStreetHousehold(key);
  });
}

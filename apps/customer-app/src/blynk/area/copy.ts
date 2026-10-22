import { centreName, kmText, radiusText, type Coverage } from './coverage';
import type { Note } from './flow';

/** Delivery-area words (kept together for the Sinhala / Tamil phase). */
export const AREA = {
  title: 'Where should we deliver?',
  pageTitle: 'Where we deliver',
  listTitle: 'Choose your area',
  useGps: 'Use my current location',
  asking: 'Finding you…',
  drag: 'Choose on the map',
  dragSub: 'Move the map so the pin sits on your house',
  list: 'Choose my area from a list',
  listSub: 'Then type your house, street or landmark',
  inside: 'We deliver here',
  outside: "We don't deliver there yet",
  fromStore: 'from Blynk',
  notListed: "Don't see your area? Drag the pin to your house instead.",
  store: 'Blynk',
  sea: 'Indian Ocean',
  galleRoad: 'Galle Rd',
  river: 'Bentota river',
  legendInside: 'Inside: we deliver',
  legendOutside: 'Outside: not yet',
  seeMap: 'See the delivery area',
  setAddress: 'Set my delivery address',
  mapNote: 'Distances are straight-line from the store.',
  near: (name: string) => `Near ${name}`,
  radiusLabel: (c: Coverage) => `${radiusText(c.radiusKm)} delivery area`,
  within: (c: Coverage) => `We deliver within ${radiusText(c.radiusKm)} of the ${centreName(c)}.`,
  withinShort: (c: Coverage) => `We deliver within ${radiusText(c.radiusKm)} of ${centreName(c)}`,
  farLine: (km: number, c: Coverage) => `This spot is ${kmText(km)} from the store. We deliver within ${radiusText(c.radiusKm)}. Move the pin closer to continue.`,
  farHead: 'Looks outside our delivery area',
  areaLine: (name: string) => `We put the pin in the middle of ${name}. Move the map so the pin sits on your house.`,
};

/** The note above the area map / on the map picker for each situation. */
export function noteText(n: Note): string | null {
  switch (n) {
    case 'denied': return "Location access is off. That's fine: choose your house on the map.";
    case 'unavailable': return "We couldn't get your location. Choose your house on the map.";
    case 'timeout': return 'Finding your location took too long. Choose your house on the map.';
    case 'unsupported': return "This phone can't share its location here. Choose your house on the map.";
    case 'outsideFix': return "You're outside our delivery area right now. If the order is for somewhere inside the circle, set that spot.";
    case 'drag': return 'The map starts at the store. Drag it so the pin sits on your house.';
    case 'areaPicked': return null;
    default: return null;
  }
}

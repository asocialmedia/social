// One-request-at-a-time guard for the HackerNews loaders.
//
// Changing the sort, the type filter or the search starts a new first-page
// load, and the two requests can settle in either order. Without a guard the
// slower, older response lands last and replaces the list with results for
// controls the viewer already moved away from - the same hazard for the
// bookmark read, which is a second await after the page itself.
//
// Each loader takes a ticket when it starts and writes back only while that
// ticket is still the newest. Starting a ticket retires every older one, and
// `cancel` retires the current one without starting a load, which is what an
// effect cleanup needs when the screen goes away. The append path uses
// `current` instead: an append belongs to whatever first page is on screen, so
// it must not retire anything, only watch.

export interface LoadTicket {
  /** Starts a load, retiring every older one. Returns its own still-current check. */
  begin: () => () => boolean;
  /** Retires whatever is in flight, without starting a load. */
  cancel: () => void;
  /** The still-current check for a load that must not retire the current ticket. */
  current: () => () => boolean;
}

export function createLoadTicket(): LoadTicket {
  let generation = 0;
  const check = (ticket: number) => () => generation === ticket;
  return {
    begin: () => {
      generation += 1;
      return check(generation);
    },
    cancel: () => {
      generation += 1;
    },
    current: () => check(generation),
  };
}

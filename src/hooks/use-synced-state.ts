'use client';

import { useState } from 'react';

/**
 * Local state that resets when an external value changes.
 *
 * The obvious implementation -- `useEffect(() => setState(prop), [prop])` --
 * renders once with the stale value, then again with the new one, and React's
 * compiler lint rejects it for exactly that reason. This instead adjusts state
 * *during* render, which React documents as the correct pattern: the extra
 * render happens before anything is committed to the DOM, so there is no
 * flash of the previous value.
 *
 * Use it where a component keeps editable local state that must follow a
 * server-rendered prop or the URL -- a search box tracking `?q=`, a cart badge
 * tracking a server count, a menu that should close on navigation.
 *
 * @param token  Changing this resets the state.
 * @param derive Produces the value to reset to. Called on mount and on reset.
 */
export const useSyncedState = <S,>(
  token: unknown,
  derive: () => S,
): [S, React.Dispatch<React.SetStateAction<S>>] => {
  const [state, setState] = useState<S>(derive);
  const [previousToken, setPreviousToken] = useState(token);

  if (token !== previousToken) {
    setPreviousToken(token);
    setState(derive());
  }

  return [state, setState];
};

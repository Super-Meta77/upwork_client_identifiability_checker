import { useState } from 'preact/hooks';
import type { Account } from '../../store/supabase';

interface Props {
  configured: boolean;
  /** undefined while loading. */
  account: Account | null | undefined;
  /** Resolves with an error message, or null when signed in. */
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignOut: () => void;
}

/** D-32: sign-in to the Supabase project that keeps the history. */
export function DatabaseView({ configured, account, onSignIn, onSignOut }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!configured) {
    return (
      <p class="notice error" role="status">
        The results database is not set up. Put your Supabase project's URL and anon key in <code>.env.local</code> (see the README, "Results database"), then build
        again.
      </p>
    );
  }
  if (account === undefined) return null;

  return (
    <fieldset>
      <legend>Results database</legend>
      {account ? (
        <div class="row wrap">
          <span role="status">Signed in as {account.email || 'your account'}. Results are saved to your Supabase project.</span>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const message = await onSignIn(email, password);
            setBusy(false);
            setError(message);
            if (!message) setPassword('');
          }}
        >
          <p class="muted small">Sign in with the user you created in your Supabase project. Checks can start once you are signed in.</p>
          <label for="db-email">Email</label>
          <input id="db-email" type="email" autocomplete="username" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
          <label for="db-password">Password</label>
          <input id="db-password" type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
          <div class="row">
            <button type="submit" class="primary" disabled={busy}>
              Sign in
            </button>
            {error && (
              <span class="notice error" role="alert">
                {error}
              </span>
            )}
          </div>
        </form>
      )}
    </fieldset>
  );
}

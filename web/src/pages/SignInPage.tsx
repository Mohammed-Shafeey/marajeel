import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth, useSignIn } from '../auth/useAuth';
import { Button, TopBar, errorMessage, useToast } from '../components/ui';

/**
 * `/signin#<code>`: the personal admin link. The code sits in the URL fragment, so it never reaches
 * server logs; we exchange it for a session cookie and drop it from the address bar right away.
 */
export default function SignInPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const signIn = useSignIn();
  const [code, setCode] = useState('');
  const submitRef = useRef<(c: string) => void>(() => {});

  const submit = (c: string) =>
    signIn.mutate(c.trim(), {
      onSuccess: (me) => {
        toast(t('auth.welcome', { name: me.name }));
        nav('/settings', { replace: true });
      },
    });
  submitRef.current = submit;

  // Opened from a link (or the link pasted into the address bar while already on this page).
  useEffect(() => {
    const fromHash = () => {
      const c = decodeURIComponent(location.hash.slice(1));
      if (!c) return;
      history.replaceState(null, '', location.pathname);
      submitRef.current(c);
    };
    fromHash();
    addEventListener('hashchange', fromHash);
    return () => removeEventListener('hashchange', fromHash);
  }, []);

  return (
    <>
      <TopBar title={t('auth.title')} back="/settings" />
      <div className="page max-w-md">
        {auth.isAdmin && !signIn.isPending && <p className="card-panel mb-4 p-4 font-semibold">{t('settings.signedInAs', { name: auth.name })}</p>}
        <form
          className="card-panel flex flex-col gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            // Accept either the bare code or the whole link pasted in.
            const c = code.includes('#') ? code.slice(code.indexOf('#') + 1) : code;
            if (c.trim()) submit(c);
          }}
        >
          <p className="text-small text-fg-2">{t('auth.intro')}</p>
          <div>
            <label className="field-label" htmlFor="signin-code">{t('auth.code')}</label>
            <input id="signin-code" className="w-full" dir="ltr" autoComplete="off" autoCapitalize="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {signIn.isError && (
            <p role="alert" className="text-small font-semibold text-loss">
              {errorMessage(signIn.error, t)}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={signIn.isPending || !code.trim()}>
            {signIn.isPending ? t('auth.signingIn') : t('auth.submit')}
          </Button>
        </form>
      </div>
    </>
  );
}

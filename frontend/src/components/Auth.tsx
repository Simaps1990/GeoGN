import { useState } from 'react';
import { Lock, Mail, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

function formatAuthError(err: unknown) {
  const raw = (err as any)?.message ? String((err as any).message) : 'Erreur';
  const msg = raw.toLowerCase();

  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return 'Email ou mot de passe incorrect.';
  }
  if (msg.includes('email not confirmed') || msg.includes('confirm your email')) {
    return "Email non confirmé. Vérifie ta boîte mail (et les spams).";
  }
  if (msg.includes('user already registered') || msg.includes('already registered')) {
    return 'Un compte existe déjà avec cet email.';
  }
  if (msg.includes('password should be at least') || msg.includes('password is too short')) {
    return 'Mot de passe trop court.';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Trop de tentatives. Réessaie dans quelques minutes.';
  }
  if (msg.includes('unable to validate email address') || msg.includes('invalid email')) {
    return 'Adresse email invalide.';
  }

  return raw;
}

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        await signUp(email, password, displayName || email);
      } else {
        await signIn(email, password);
      }
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full bg-black bg-cover bg-center bg-no-repeat flex items-center justify-center px-4 py-10"
      style={{ backgroundImage: "url('/icon/fondgris.png')" }}
    >
      <div className="w-full max-w-md rounded-3xl bg-[#1c1f24] px-8 pt-2 pb-8 shadow-[0_30px_90px_rgba(0,0,0,0.65)] ring-1 ring-white/10">
        <div className="flex flex-col items-center text-center">
          <img
            src="/icon/patte.png"
            alt="GeoGN"
            className="h-80 w-80 object-contain drop-shadow -mt-12 -mb-16"
          />
          <h1 className="-mt-4 text-4xl font-semibold tracking-wide text-white">GeoGN</h1>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 grid gap-4">
          {isSignUp ? (
            <div className="relative">
              <User size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/60" />
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-12 w-full rounded-xl border border-white/10 bg-[#262a31] pl-11 pr-4 text-sm text-white placeholder:text-white/50 outline-none autofill:bg-[#262a31] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#262a31]"
                placeholder="Nom d'affichage"
                autoComplete="nickname"
              />
            </div>
          ) : null}

          <div className="relative">
            <Mail size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/60" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-12 w-full rounded-xl border border-white/10 bg-[#262a31] pl-11 pr-4 text-sm text-white placeholder:text-white/50 outline-none autofill:bg-[#262a31] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#262a31]"
              placeholder="Adresse e-mail"
              autoComplete="email"
            />
          </div>

          <div className="relative">
            <Lock size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/60" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-12 w-full rounded-xl border border-white/10 bg-[#262a31] pl-11 pr-4 text-sm text-white placeholder:text-white/50 outline-none autofill:bg-[#262a31] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#262a31]"
              placeholder="Mot de passe"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
            {!isSignUp ? (
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-white/55 hover:text-white/80"
              >
                Mot de passe oublié ?
              </button>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 inline-flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-b from-blue-500 to-blue-700 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(37,99,235,0.35)] transition disabled:opacity-50"
          >
            {loading ? 'Chargement...' : isSignUp ? 'Créer un compte' : 'Se connecter'}
          </button>
          {!isSignUp ? (
            <button
              type="button"
              onClick={() => {
                window.location.href = '/api/login';
              }}
              className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#15181d] text-xs font-medium text-white/80 hover:bg-[#1f232a] hover:text-white transition"
            >
              <Lock size={16} className="text-white/70" />
              <span>Se connecter avec Keycloak</span>
            </button>
          ) : null}
        </form>

        <div className="mt-6 text-center text-sm text-white/70">
          {isSignUp ? 'Déjà un compte ? ' : 'Pas encore de compte ? '}
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="font-semibold text-blue-400 hover:text-blue-300"
          >
            {isSignUp ? 'Se connecter' : "S'inscrire"}
          </button>
        </div>
      </div>
    </div>
  );
}

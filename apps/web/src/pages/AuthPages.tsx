import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import type { ZodType } from 'zod';
import {
  loginSchema,
  registerSchema,
  type AuthResponse,
  type LoginInput,
  type RegisterInput,
} from '@billetterie/shared';
import { safeNext } from '../components/RequireRole';
import { ErrorState } from '../components/States';
import { useDemoLogin } from '../hooks/useDemoLogin';
import { api } from '../lib/endpoints';
import { sessionStore } from '../lib/session';
import { useToast } from '../lib/toast';

type FieldErrors = Partial<Record<string, string>>;

/** Validation par le schéma Zod partagé avec l'API : mêmes règles, mêmes messages. */
function validate<T>(schema: ZodType<T>, values: unknown): { data?: T; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data, errors: {} };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? 'form');
    errors[field] ??= issue.message;
  }
  return { errors };
}

/** Après connexion : la page demandée, sinon la page d'accueil du rôle. */
function useAfterLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  return (session: AuthResponse) => {
    const home = session.user.role === 'traveler' ? '/' : '/controle';
    void navigate(next ?? home, { replace: true });
  };
}

function Field({
  id,
  label,
  error,
  ...input
}: { id: string; label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        name={id}
        className="field"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...input}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function AuthCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-bold">{title}</h1>
      {children}
      <div className="text-center text-sm text-slate-600">{footer}</div>
    </div>
  );
}

function DemoButtons() {
  const afterLogin = useAfterLogin();
  const demo = useDemoLogin(() => afterLogin(sessionStore.get()!));
  return (
    <div className="card space-y-2">
      <p className="text-sm text-slate-600">Ou, sans compte :</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={demo.isPending}
          onClick={() => demo.mutate('traveler')}
        >
          Voyageur de démo
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={demo.isPending}
          onClick={() => demo.mutate('controller')}
        >
          Contrôleur de démo
        </button>
      </div>
    </div>
  );
}

export function LoginPage() {
  const afterLogin = useAfterLogin();
  const toast = useToast();
  const [params] = useSearchParams();
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const login = useMutation({
    mutationFn: (input: LoginInput) => api.login(input),
    onSuccess: (result) => {
      sessionStore.set(result);
      toast.show(`Bonjour ${result.user.name} !`, 'success');
      afterLogin(result);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const { data, errors } = validate(loginSchema, values);
    setErrors(errors);
    if (data) login.mutate(data);
  };
  const next = params.get('next');

  return (
    <AuthCard
      title="Connexion"
      footer={
        <>
          Pas encore de compte ?{' '}
          <Link
            to={`/inscription${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-sky-800 underline"
          >
            Créer un compte
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="card space-y-3" noValidate aria-label="Connexion">
        <Field
          id="email"
          label="E-mail"
          type="email"
          autoComplete="email"
          value={values.email}
          error={errors.email}
          onChange={(e) => setValues({ ...values, email: e.target.value })}
        />
        <Field
          id="password"
          label="Mot de passe"
          type="password"
          autoComplete="current-password"
          value={values.password}
          error={errors.password}
          onChange={(e) => setValues({ ...values, password: e.target.value })}
        />
        {login.isError && <ErrorState error={login.error} />}
        <button type="submit" className="btn-primary w-full" disabled={login.isPending}>
          {login.isPending ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <DemoButtons />
    </AuthCard>
  );
}

export function RegisterPage() {
  const afterLogin = useAfterLogin();
  const toast = useToast();
  const [params] = useSearchParams();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const register = useMutation({
    mutationFn: (input: RegisterInput) => api.register(input),
    onSuccess: (result) => {
      sessionStore.set(result);
      toast.show(`Bienvenue ${result.user.name} !`, 'success');
      afterLogin(result);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const { data, errors } = validate(registerSchema, values);
    setErrors(errors);
    if (data) register.mutate(data);
  };
  const next = params.get('next');

  return (
    <AuthCard
      title="Créer un compte"
      footer={
        <>
          Déjà inscrit ?{' '}
          <Link
            to={`/connexion${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-sky-800 underline"
          >
            Se connecter
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="card space-y-3" noValidate aria-label="Inscription">
        <Field
          id="name"
          label="Nom"
          autoComplete="name"
          value={values.name}
          error={errors.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
        <Field
          id="email"
          label="E-mail"
          type="email"
          autoComplete="email"
          value={values.email}
          error={errors.email}
          onChange={(e) => setValues({ ...values, email: e.target.value })}
        />
        <Field
          id="password"
          label="Mot de passe (8 caractères minimum)"
          type="password"
          autoComplete="new-password"
          value={values.password}
          error={errors.password}
          onChange={(e) => setValues({ ...values, password: e.target.value })}
        />
        {register.isError && <ErrorState error={register.error} />}
        <button type="submit" className="btn-primary w-full" disabled={register.isPending}>
          {register.isPending ? 'Création…' : 'Créer mon compte'}
        </button>
      </form>
    </AuthCard>
  );
}

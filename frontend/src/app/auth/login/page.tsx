'use client';

import { signIn } from 'next-auth/react';
import { FormEvent, useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const result = await signIn('credentials', {
      email,
      password,
      callbackUrl: '/dashboard',
      redirect: false,
    });
    setLoading(false);
    if (result?.error) setError('Invalid email or password');
    else if (result?.url) window.location.href = result.url;
  }

  return (
    <main>
      <h1>Service Desk</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => signIn('azure-ad', { callbackUrl: '/dashboard' })}
      >
        Sign in with Microsoft
      </button>
    </main>
  );
}

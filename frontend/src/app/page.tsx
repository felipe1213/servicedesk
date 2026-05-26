import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1>Service Desk</h1>
      <Link href="/auth/login">Sign In</Link>
    </main>
  );
}

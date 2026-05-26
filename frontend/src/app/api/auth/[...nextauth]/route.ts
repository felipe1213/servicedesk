import NextAuth from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import CredentialsProvider from 'next-auth/providers/credentials';

const handler = NextAuth({
  providers: [
    AzureADProvider({
      clientId: process.env.ENTRA_CLIENT_ID!,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
      tenantId: process.env.ENTRA_TENANT_ID!,
    }),
    CredentialsProvider({
      name: 'Local',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.accessToken = (user as any).accessToken;
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      return session;
    },
  },
  pages: { signIn: '/auth/login' },
  session: { strategy: 'jwt' },
});

export { handler as GET, handler as POST };

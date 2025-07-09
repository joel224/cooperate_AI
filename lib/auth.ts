// auth.ts
import { AuthOptions, getServerSession as getNextAuthServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials'; // Added for temporary local authentication

export const authOptions: AuthOptions = {
  providers: [
    // Credentials Provider: Temporary local authentication for development.
    // This simulates a traditional username/password login.
    // In a production environment, this should be replaced with a secure, database-backed system.
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text', placeholder: 'developer or admin' }, // Updated placeholder
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        // TODO: Replace with actual user validation from your database.
        // For development, hardcoded users are used for simplicity.
        if (credentials?.username === 'developer' && credentials?.password === 'password') {
          return { id: '1', name: 'Developer User', email: 'developer@example.com' };
        }
        // Add a 'sales' user for testing role-based access
        if (credentials?.username === 'sales' && credentials?.password === 'salespassword') {
                return { id: '3', name: 'Sales User', email: 'sales@example.com' };
        }
        if (credentials?.username === 'admin' && credentials?.password === 'adminpassword') { // Added admin user
          return { id: '2', name: 'Admin User', email: 'admin@example.com' };
        }
        return null; // Return null if authentication fails
      },
    }),
    // Google OAuth Provider: Configured for external authentication.
    // This will be used when you integrate with Google Cloud for full sign-in.
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // This is called on sign-in (with user) and on every API call (without user).
      if (user) { // On sign-in, persist the user's id and role to the token.
        token.id = user.id;
        if (user.email === 'admin@example.com') {
          token.role = 'admin';
        
        } else if (user.email === 'sales@example.com') {
                token.role = 'sales';
        } else if (user.email === 'developer@example.com') {
          token.role = 'developer';
        } else {
          token.role = 'user';
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Attach the role and id from the JWT token to the session object.
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as 'admin' | 'user' | 'developer';
      }
      return session;
    },
  },
  pages: { // Custom pages for NextAuth.js.
    signIn: '/login', // Path to the custom sign-in page.
  },
  session: {
    strategy: 'jwt', // Use JWT for session management.
  },
  secret: process.env.NEXTAUTH_SECRET, // Secret for signing session cookies.
};

// Helper function to get session in Server Components.
export const getServerSession = () => getNextAuthServerSession(authOptions);

export type Role = 'ADMIN' | 'MANAGER' | 'AGENT' | 'END_USER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  accessToken: string;
}
